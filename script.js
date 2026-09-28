(function(){
'use strict';

const FIREBASE_CONFIG = {
  apiKey: 'PASTE_FIREBASE_API_KEY',
  authDomain: 'PASTE_FIREBASE_AUTH_DOMAIN',
  databaseURL: 'PASTE_FIREBASE_DATABASE_URL',
  projectId: 'PASTE_FIREBASE_PROJECT_ID',
  storageBucket: 'PASTE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'PASTE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'PASTE_FIREBASE_APP_ID'
};
// Optional App Check Site Key if implemented
const FIREBASE_APPCHECK_SITE_KEY = 'PASTE_FIREBASE_APPCHECK_SITE_KEY';

const SECURITY_CONFIG = {
    MAX_CHAT_CHARS: 500
};

let db = null;
let fbUser = null;
let matchRef = null;
let matchRoomId = null;
let onlineHost = false;
let onlinePlayerIndex = -1;
let matchPollTimer = null;
let onlinePaid = false;

let peer = null;
let peerConnections = {};
let localMediaStream = null;
let remoteMediaStreams = {};

let players = [], current = 0, dice = 0, rolled = false, rolling = false;
let moving = false, sixCount = 0, started = false;
let turnTimer = null, timeLeft = 20;
let turnSerial = 0, cpuTimer = null;
let userProfile = null, totalCoins = 10000, entryFee = 500;
let ranks = [];
let audioCtx = null;
let currentMode = 'local';
let onlinePlayerInterval = null;
let aiLevel = 'easy';

const COLORS = ['green', 'yellow', 'blue', 'red'];
const COLOR_NAMES = { green:'Green', yellow:'Yellow', blue:'Blue', red:'Red' };
const COLOR_HEX = { green:'#10a953', yellow:'#f0c91b', blue:'#2998df', red:'#ed1c24' };

const TRACK = [[6,0], [6,1], [6,2], [6,3], [6,4], [6,5], [5,6], [4,6], [3,6], [2,6], [1,6], [0,6], [0,7], [0,8], [1,8], [2,8], [3,8], [4,8], [5,8], [6,9], [6,10], [6,11], [6,12], [6,13], [6,14], [7,14], [8,14], [8,13], [8,12], [8,11], [8,10], [8,9], [9,8], [10,8], [11,8], [12,8], [13,8], [14,8], [14,7], [14,6], [13,6], [12,6], [11,6], [10,6], [9,6], [8,5], [8,4], [8,3], [8,2], [8,1], [8,0], [7,0]];
const START_INDEX = { red: 1, green: 14, yellow: 27, blue: 40 };
const SAFE = [1, 9, 14, 22, 27, 35, 40, 48];
const HOME_LANES = { green:[ [1,7], [2,7], [3,7], [4,7], [5,7] ], yellow:[ [7,13], [7,12], [7,11], [7,10], [7,9] ], blue:[ [13,7], [12,7], [11,7], [10,7], [9,7] ], red:[ [7,1], [7,2], [7,3], [7,4], [7,5] ] };
const HOME_POS = { red:[{t:10.2, l:10.2}, {t:10.2, l:29.8}, {t:29.8, l:10.2}, {t:29.8, l:29.8}], green:[{t:10.2, l:70.2}, {t:10.2, l:89.8}, {t:29.8, l:70.2}, {t:29.8, l:89.8}], blue:[{t:70.2, l:10.2}, {t:70.2, l:29.8}, {t:89.8, l:10.2}, {t:89.8, l:29.8}], yellow:[{t:70.2, l:70.2}, {t:70.2, l:89.8}, {t:89.8, l:70.2}, {t:89.8, l:89.8}] };

const cells = document.getElementById('cells');
const tokenLayer = document.getElementById('tokenLayer');
const turnMsg = document.getElementById('turnMsg');

// --- UTILS & SECURITY ---
function firebaseConfigured() { return FIREBASE_CONFIG.apiKey !== 'PASTE_FIREBASE_API_KEY'; }
function validUid(uid) { return typeof uid === 'string' && uid.length > 5; }
function securityFail(msg) { console.warn("Security Alert: " + msg); }
function secureOnlineAllowed() { return firebaseConfigured(); }

function validateActionPacket(action, payload, fromUid) {
    if(!validUid(fromUid)) return false;
    if(action === 'move' && (typeof payload.index !== 'number' || payload.index < 0 || payload.index > 3)) return false;
    if(action !== 'roll' && action !== 'move') return false;
    return true;
}

function validatePlayerState(p) {
    if(!p || typeof p.id !== 'number' || !Array.isArray(p.tokens) || p.tokens.length !== 4) return false;
    for(let i=0; i<4; i++){ if(typeof p.tokens[i] !== 'number' || p.tokens[i] < 0 || p.tokens[i] > 57) return false; }
    return true;
}

function validateGameState(state) {
    if(!state || typeof state !== 'object') return false;
    if(typeof state.current !== 'number' || state.current < 0 || state.current > 3) return false;
    if(typeof state.dice !== 'number' || state.dice < 0 || state.dice > 6) return false;
    if(Array.isArray(state.players)){ for(let p of state.players){ if(p && !validatePlayerState(p)) return false; } }
    return true;
}

function coinChoice() { return document.getElementById('entryFeeSelect').value; }
function onlineCount() { return parseInt(document.getElementById('playerCount').value, 10); }
function roomId() { return 'room_' + Math.random().toString(36).substring(2, 10) + Date.now(); }
function onlinePlayer(id, color, feeParam) {
    return {
        id: id, color: color, name: userProfile.name, avatar: userProfile.avatar, flag: userProfile.flag,
        requestedFee: feeParam, cpu: false, offline: false, active: true, tokens: [0,0,0,0], rank: 0, uid: fbUser.uid
    };
}

// --- FULLSCREEN & AUDIO ---
window.toggleFullScreen = function() {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(e => {}); } 
    else { if (document.exitFullscreen) document.exitFullscreen(); }
};
window.playAudio = function(type) {
    if(!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} }
    if(!audioCtx || audioCtx.state === 'suspended') return;
    let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination); let now = audioCtx.currentTime;
    if(type === 'roll') { osc.frequency.setValueAtTime(400, now); osc.frequency.exponentialRampToValueAtTime(100, now + 0.1); gain.gain.setValueAtTime(0.3, now); gain.gain.linearRampToValueAtTime(0.01, now + 0.1); osc.start(now); osc.stop(now + 0.1); }
    else if(type === 'move') { osc.type='sine'; osc.frequency.setValueAtTime(600, now); gain.gain.setValueAtTime(0.2, now); gain.gain.linearRampToValueAtTime(0.01, now+0.05); osc.start(now); osc.stop(now+0.05); }
};

// --- PROFILE & COINS ---
window.loadCoins = function() {
    let c = localStorage.getItem('ludoCoins');
    let lastLogin = localStorage.getItem('ludoLastLogin');
    let now = Date.now();
    if(!c) { totalCoins = 10000; } 
    else { 
        totalCoins = parseInt(c, 10); 
        if(lastLogin && (now - parseInt(lastLogin)) > 3600000) {
            if(totalCoins < 10000) {
                totalCoins += 10000;
                alert("Welcome Back! You received 10,000 💰 hourly bonus.");
            }
        }
    }
    localStorage.setItem('ludoCoins', totalCoins);
    localStorage.setItem('ludoLastLogin', now);
    document.getElementById('coinCountBoard').innerText = totalCoins;
};

window.saveProfile = function() {
    userProfile = {
        name: (document.getElementById('pName').value||'Guest').trim().slice(0,15),
        avatar: document.getElementById('pAvatar').value,
        flag: document.getElementById('pCountry').value.split('|')[1],
        age: Math.max(1, parseInt(document.getElementById('pAge').value||18, 10)),
        gender: document.getElementById('pGender').value
    };
    localStorage.setItem('ludoProfile', JSON.stringify(userProfile));
    if(!localStorage.getItem('ludoCoins')) localStorage.setItem('ludoCoins', 10000);
    document.getElementById('profileModal').classList.add('hide'); 
    loadCoins();
    const invite = new URLSearchParams(location.search).get('invite');
    if(invite) joinFriendRoom(invite);
};

window.loginWithGoogle = async function(){
  try{
    await ensureFirebaseBase();
    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await firebase.auth().signInWithPopup(provider);
    fbUser = result.user;
    const existing = localStorage.getItem('ludoProfile');
    if(!existing){
      document.getElementById('loginModal').classList.add('hide');
      document.getElementById('pName').value = (result.user.displayName||'Player').slice(0,15);
      document.getElementById('profileModal').classList.remove('hide');
      return;
    }
    userProfile = JSON.parse(existing);
    document.getElementById('loginModal').classList.add('hide');
    const invite = new URLSearchParams(location.search).get('invite');
    if(invite) await joinFriendRoom(invite);
  }catch(e){console.error(e);alert('Login failed: '+e.message);}
};

window.ensureFirebaseBase = async function(){
    if(!firebaseConfigured()) throw new Error('Firebase config missing');
    if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    return firebase.auth();
};

window.ensureOnline = async function(){
    await ensureFirebaseBase();
    if(!firebase.auth().currentUser){
        const result = await firebase.auth().signInAnonymously();
        fbUser = result.user;
    } else {
        fbUser = firebase.auth().currentUser;
    }
};

window.checkProfile = async function(){
  try{
    const s = localStorage.getItem('ludoProfile'); 
    if(s) { userProfile = JSON.parse(s); loadCoins(); }
    const invite = new URLSearchParams(location.search).get('invite');
    if(invite){
      if(!s){document.getElementById('loginModal').classList.remove('hide');return;}
      await ensureFirebaseBase();
      if(firebase.auth().currentUser){fbUser=firebase.auth().currentUser; joinFriendRoom(invite);}
      else document.getElementById('loginModal').classList.remove('hide');
    }else if(!s) document.getElementById('profileModal').classList.remove('hide');
  }catch(e){console.error(e);}
};

window.stopOnline = function() {
    clearInterval(matchPollTimer); matchPollTimer = null;
    onlinePaid = false;
    if(matchRef && fbUser) {
        try{ matchRef.child('players/'+fbUser.uid).onDisconnect().cancel(); }catch(e){}
        matchRef.off(); 
    }
    matchRef = null; matchRoomId = null; onlineHost = false; onlinePlayerIndex = -1;
    if(peer) { peer.destroy(); peer = null; }
    peerConnections = {};
    Object.values(remoteMediaStreams).forEach(s => s.getTracks().forEach(t=>t.stop()));
    remoteMediaStreams = {};
    if(localMediaStream) { localMediaStream.getTracks().forEach(t=>t.stop()); localMediaStream = null; }
    const vids = document.querySelectorAll('.remote-video');
    vids.forEach(v => { v.srcObject = null; v.style.display = 'none'; });
};

window.goHome = function() { 
    started = false; 
    clearGameTimers();
    clearInterval(onlinePlayerInterval);
    stopOnline();
    document.getElementById('chatWrap').style.display='none';
    document.getElementById('ludoGame').style.display='none'; 
    document.getElementById('homeScreen').style.display='flex'; 
    document.getElementById('winnerModal').classList.add('hide');
    document.getElementById('friendRequestModal').classList.add('hide');
    loadCoins(); 
};

// --- MENUS & SHARING ---
window.openConfigModal = function(mode){
  currentMode = mode; 
  document.getElementById('playerCount').disabled = false;
  if(mode === 'ai'){
      document.getElementById('configTitle').innerText = '🤖 Setup AI Game'; 
      document.getElementById('aiOptions').style.display = 'block';
  } else {
      document.getElementById('configTitle').innerText = '🌐 Setup Online Match'; 
      document.getElementById('aiOptions').style.display = 'none';
  }
  document.getElementById('startModal').classList.remove('hide');
};
window.openLocalGameModal=function(){document.getElementById('localGameModal').classList.remove('hide');};

window.startLocalGame = function(){
  const pc = parseInt(document.getElementById('localPlayerCount').value,10)||4; 
  currentMode = 'local'; entryFee = 0;
  const selected = pc===2?['green','blue']:(pc===3?['green','yellow','blue']:['green','yellow','blue','red']);
  players = selected.map((color,i)=>({id:i,color,name:i===0?(userProfile?.name||'Player 1'):'Player '+(i+1),avatar:i===0?(userProfile?.avatar||'👨'):['👩','👦','👧'][i-1]||'👤',flag:i===0?(userProfile?.flag||''):'',cpu:false,aiLevel:'',tokens:[0,0,0,0],rank:0,offline:false,extraUsed:false,active:true,uid:'local-'+i}));
  document.getElementById('localGameModal').classList.add('hide');
  document.getElementById('homeScreen').style.display='none';
  document.getElementById('ludoGame').style.display='block';
  document.getElementById('chatWrap').style.display='none';
  started = true; ranks = []; current = 0; turnSerial++;
  updatePlayersHUD(); renderTokens(); beginTurn();
};

window.createFriendRoom = async function(){
  await ensureOnline(); 
  const rid = roomId(); matchRoomId = rid; matchRef = db.ref('ludoRooms/'+rid);
  onlineHost = true; onlinePlayerIndex = 0;
  const me = onlinePlayer(0,'green','friends');
  await matchRef.set({type:'friend',hostUid:fbUser.uid,fee:0,count:2,status:'waiting',inviteStatus:'waiting',createdAt:firebase.database.ServerValue.TIMESTAMP,players:{[fbUser.uid]:me}});
  matchRef.child('players/'+fbUser.uid).onDisconnect().remove(); 
  bindFriendRoom(rid); 
  return rid;
};

window.startPlayWithFriends = async function(){
    try{
        await createFriendRoom();
        document.getElementById('homeScreen').style.display='none';
        document.getElementById('ludoGame').style.display='block';
        document.getElementById('chatWrap').style.display='block';
        started=false; updatePlayersHUD(); 
        turnMsg.textContent='Invite your friend — waiting for acceptance';
        await openShareModal();
    }catch(e){alert('Friend room failed: '+e.message);}
};

window.openShareModal = async function(){
    try{
        if(!matchRoomId||!matchRef) await createFriendRoom();
        document.getElementById('shareModal').classList.remove('hide');
    }catch(e){alert('Share room create failed: '+e.message);}
};

window.shareTo = function(platform){
  if(!matchRoomId){alert('Invite room create nahi hua.');return;}
  const inviteUrl = window.location.href.split('?')[0]+'?invite='+encodeURIComponent(matchRoomId);
  const txt = encodeURIComponent('Aao Ludo Premium khelein! Mere game invite par click karein: ');
  if(platform==='whatsapp')window.open('https://api.whatsapp.com/send?text='+txt+encodeURIComponent(inviteUrl),'_blank');
  else if(platform==='facebook')window.open('https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(inviteUrl),'_blank');
  else if(platform==='telegram')window.open('https://t.me/share/url?url='+encodeURIComponent(inviteUrl)+'&text='+txt,'_blank');
  else if(platform==='instagram')navigator.clipboard.writeText(inviteUrl).then(()=>alert('Invite link copied! Paste it in Instagram DM.'));
  else if(navigator.share)navigator.share({title:'Ludo Premium',text:'Play Ludo with me',url:inviteUrl}).catch(()=>{});
  else navigator.clipboard.writeText(inviteUrl).then(()=>alert('Invite link copied!'));
};

window.joinFriendRoom = async function(rid){
  try{
    await ensureFirebaseBase();
    if(!firebase.auth().currentUser){document.getElementById('loginModal').classList.remove('hide');return;}
    fbUser = firebase.auth().currentUser;
    const ref = db.ref('ludoRooms/'+rid), snap = await ref.once('value'), room = snap.val(); 
    if(!room||room.type!=='friend'){alert('Friend room expired or invalid.');return;}
    const list = room.players||{};
    if(Object.keys(list).length>=2 && !list[fbUser.uid]){alert('Room already full.');return;}
    if(!list[fbUser.uid]){
        const me = onlinePlayer(1,'blue','friends');
        await ref.child('players/'+fbUser.uid).set(me);
        ref.child('players/'+fbUser.uid).onDisconnect().remove();
        await ref.child('inviteStatus').set('pending');
    }
    matchRoomId = rid; matchRef = ref; 
    onlineHost = (room.hostUid===fbUser.uid); 
    onlinePlayerIndex = onlineHost ? 0 : 1; 
    currentMode = 'friends'; 
    document.getElementById('homeScreen').style.display='flex'; 
    bindFriendRoom(rid);
  }catch(e){alert('Could not join friend room: '+e.message);}
};

window.closeFriendRequest=function(){document.getElementById('friendRequestModal').classList.add('hide');};
window.acceptFriendRequest = async function(){
    if(!matchRef||!onlineHost)return;
    await matchRef.update({status:'accepted',inviteStatus:'accepted'});
    document.getElementById('friendRequestModal').classList.add('hide');
    startFriendGame();
};
window.rejectFriendRequest = async function(){
    if(!matchRef||!onlineHost)return;
    const hostUid = fbUser.uid, snap = await matchRef.child('players').once('value'), list = snap.val()||{};
    Object.keys(list).filter(k=>k!==hostUid).forEach(k=>matchRef.child('players/'+k).remove());
    await matchRef.update({status:'waiting',inviteStatus:'rejected'});
    document.getElementById('friendRequestModal').classList.add('hide');
    turnMsg.textContent='Friend request rejected — waiting for another invitee';
};

window.bindFriendRoom = function(rid){
  const ref = db.ref('ludoRooms/'+rid); matchRef = ref;
  ref.child('players').on('value', snap => {
    const list = snap.val()||{}, arr = Object.values(list).sort((a,b)=>(a.id||0)-(b.id||0));
    if(arr.length){
        players = arr.map((q,i)=>({...q,id:i,color:i===0?'green':'blue',cpu:false,active:true,tokens:q.tokens||[0,0,0,0]}));
        updatePlayersHUD(); renderTokens();
    }
    if(onlineHost && arr.length>=2 && !started) {
        ref.child('status').once('value').then(ss=>{
            if((ss.val()||'waiting')==='waiting'){
                const inv = arr.find(q=>q.uid!==fbUser.uid);
                document.getElementById('friendRequestText').textContent=(inv?.name||'Your friend')+' wants to play Ludo with you.';
                document.getElementById('friendRequestModal').classList.remove('hide');
            }
        });
    }
  });
  ref.child('status').on('value', snap => {
      const st = snap.val();
      if(st==='rejected' && !onlineHost){alert('Host rejected the game request.');goHome();}
      if(st==='accepted' && !started) startFriendGame();
  });
  ref.child('state').on('value', snap => { if(snap.val() && !onlineHost) receiveState(snap.val()); });
  ref.child('chat').limitToLast(50).on('child_added', snap => appendChat(snap.val()));
};

window.startFriendGame = function(){
  if(started)return; if(players.filter(p=>p&&p.active).length<2)return;
  currentMode='friends'; entryFee=0; current=0; ranks=[]; started=true; turnSerial++;
  document.getElementById('friendRequestModal').classList.add('hide');
  document.getElementById('shareModal').classList.add('hide');
  document.getElementById('homeScreen').style.display='none';
  document.getElementById('ludoGame').style.display='block';
  document.getElementById('chatWrap').style.display='block';
  updatePlayersHUD(); renderTokens(); beginTurn();
  initPeer(); setTimeout(startMediaForOnline,900);
  if(onlineHost) writeState();
};

window.writeState = function(){
    if(matchRef && onlineHost && started) {
        matchRef.child('state').set({
            matchedFee: entryFee, players: players, current: current, dice: dice, 
            rolled: rolled, moving: moving, sixCount: sixCount, started: started, ts: firebase.database.ServerValue.TIMESTAMP
        });
    }
};

window.receiveState = function(v){
  if(!v||onlineHost) return;
  if(!validateGameState(v)){ securityFail('Invalid or tampered game state received.'); return; }
  
  let wasStarted = started;
  players = Array.isArray(v.players) ? v.players : players;
  
  // Preserve local turn machine state unless explicitly overwritten correctly
  let stateCurrentChanged = (current !== (v.current||0));
  current = v.current||0;
  dice = v.dice||0;
  rolled = !!v.rolled;
  moving = !!v.moving;
  rolling = false;
  sixCount = v.sixCount||0;
  started = !!v.started;
  onlinePlayerIndex = players.findIndex(p=>p&&p.uid===fbUser.uid);
  
  if(started && !wasStarted){
      let fee = Number(v.matchedFee||500); entryFee = fee;
      if(!onlinePaid && fee > 0) {
          if(totalCoins < fee){alert('Not enough coins!');stopOnline();goHome();return;}
          totalCoins -= fee; localStorage.setItem('ludoCoins',totalCoins); loadCoins(); onlinePaid = true;
      }
      initPeer(); setTimeout(startMediaForOnline,1200);
  }
  
  updatePlayersHUD(); renderTokens();
  if(stateCurrentChanged && started) beginTurn();
};

window.sendAction = function(action, payload){
    if(!matchRef || onlineHost || !fbUser || !validateActionPacket(action, payload, fbUser.uid)) return;
    matchRef.child('actions').push({ from: fbUser.uid, action: action, payload: payload||{}, ts: firebase.database.ServerValue.TIMESTAMP });
};

window.bindRoom = function(roomIdValue, isHost){
  matchRoomId = roomIdValue; matchRef = db.ref('ludoRooms/'+roomIdValue); onlineHost = isHost;
  if(isHost){
      matchRef.child('actions').on('child_added', snap => {
          let a = snap.val();
          if(!a || a.from===fbUser.uid || !validateActionPacket(a.action, a.payload, a.from)) return;
          if(a.action==='roll' && players[current] && players[current].uid===a.from) rollDice();
          if(a.action==='move' && players[current] && players[current].uid===a.from && !moving && rolled) animateMove(players[current], a.payload.index);
      });
      matchRef.child('players').on('value', snap => {
          let list = snap.val()||{};
          let arr = Object.values(list).sort((a,b)=>(a.id||0)-(b.id||0));
          if(arr.length){
              players = arr.map((q,i)=>({...q, id:i, color:['green','yellow','blue','red'][i], cpu:false, active:true, tokens:q.tokens||[0,0,0,0]}));
              updatePlayersHUD(); renderTokens();
          }
      });
      matchRef.child('chat').limitToLast(50).on('child_added', snap => appendChat(snap.val()));
  } else {
      matchRef.child('state').on('value', snap => receiveState(snap.val()));
      matchRef.child('players').on('value', snap => {
          let list = snap.val()||{};
          players = Object.values(list).sort((a,b)=>(a.id||0)-(b.id||0));
          updatePlayersHUD(); renderTokens();
      });
      matchRef.child('chat').limitToLast(50).on('child_added', snap => appendChat(snap.val()));
  }
};

window.resolveMatchedFee = function(a, b){
    if(a==='any' && b==='any') return 500;
    if(a==='any') return parseInt(b,10);
    return parseInt(a,10);
};

window.startHostWhenReady = async function(){
 let snap = await matchRef.child('players').once('value');
 let list = snap.val()||{};
 let arr = Object.values(list).sort((a,b)=>(a.id||0)-(b.id||0));
 let required = Number((await matchRef.child('count').once('value')).val()||2);
 if(arr.length < required){ turnMsg.textContent='Waiting for real player...'; return; }
 
 clearInterval(matchPollTimer); matchPollTimer=null;
 const reqFees = arr.map(x=>x.requestedFee); const fixed = reqFees.find(x=>x!=='any'); const fee = fixed?parseInt(fixed,10):500;
 await matchRef.child('matchedFee').set(fee); entryFee = fee;
 
 if(!onlinePaid && entryFee > 0) {
     if(totalCoins < entryFee){alert('Not enough coins!');stopOnline();goHome();return;}
     totalCoins -= entryFee; localStorage.setItem('ludoCoins',totalCoins); loadCoins(); onlinePaid = true;
 }
 
 players = arr.slice(0,required).map((q,i)=>({...q, id:i, color:['green','yellow','blue','red'][i], cpu:false, active:true, tokens:[0,0,0,0], rank:0}));
 currentMode='online'; onlinePlayerIndex=0; started=true; ranks=[]; current=0; turnSerial++;
 document.getElementById('startModal').classList.add('hide'); document.getElementById('homeScreen').style.display='none';
 document.getElementById('ludoGame').style.display='block'; document.getElementById('chatWrap').style.display='block';
 updatePlayersHUD(); renderTokens(); beginTurn(); writeState();
 initPeer(); setTimeout(startMediaForOnline,900);
};

window.createOrJoinRealMatch = async function(){
 if(!secureOnlineAllowed()){ securityFail('Configure Firebase in script first.'); return; }
 try{
     await ensureOnline();
     let fee = coinChoice(), count = onlineCount();
     document.getElementById('startModal').classList.add('hide'); document.getElementById('homeScreen').style.display='none'; document.getElementById('ludoGame').style.display='block';
     turnMsg.textContent='Searching real online players...';
     
     let qref = db.ref('ludoQueue'), snap = await qref.once('value'), q = snap.val()||{}, found = null;
     Object.keys(q).some(k=>{
         let x=q[k]; if(!x||x.uid===fbUser.uid)return false;
         let feeOK = (fee==='any'||x.fee==='any'||String(x.fee)===String(fee));
         if(feeOK && Number(x.count)===count){ found={key:k,...x}; return true; } return false;
     });
     
     if(found){
         await qref.child(found.key).remove();
         matchRoomId = found.roomId; matchRef = db.ref('ludoRooms/'+matchRoomId);
         let me = onlinePlayer(1, 'blue', fee);
         await matchRef.child('players/'+fbUser.uid).set(me);
         matchRef.child('players/'+fbUser.uid).onDisconnect().remove();
         onlinePlayerIndex = 1; document.getElementById('chatWrap').style.display='block';
         bindRoom(matchRoomId, false);
         turnMsg.textContent='Opponent found. Connecting...';
         return;
     }
     
     let rid = roomId(), me = onlinePlayer(0, 'green', fee);
     matchRoomId = rid; matchRef = db.ref('ludoRooms/'+rid);
     await matchRef.set({hostUid:fbUser.uid, fee:fee, count:count, players:{[fbUser.uid]:me}, createdAt:firebase.database.ServerValue.TIMESTAMP});
     qref.child(fbUser.uid).set({roomId:rid, uid:fbUser.uid, fee:fee, count:count, ts:firebase.database.ServerValue.TIMESTAMP});
     qref.child(fbUser.uid).onDisconnect().remove(); matchRef.child('players/'+fbUser.uid).onDisconnect().remove();
     document.getElementById('chatWrap').style.display='block';
     bindRoom(rid, true); onlineHost = true; onlinePlayerIndex = 0;
     turnMsg.textContent='Waiting for a real opponent...';
     matchPollTimer = setInterval(startHostWhenReady, 1200);
 }catch(e){console.error(e);alert('Online setup failed: '+e.message);stopOnline();goHome();}
};

window.startRealOnlineFromButton = function(){
    let v = document.getElementById('entryFeeSelect').value;
    entryFee = (v==='any') ? 0 : parseInt(v,10);
    if(v!=='any' && totalCoins < entryFee){ alert('Not enough coins!'); return; }
    createOrJoinRealMatch();
};

window.initPeer = function(){
    if(typeof Peer==='undefined'){turnMsg.textContent='WebRTC library load failed';return;}
    peer = new Peer(undefined, {host:'0.peerjs.com', port:443, path:'/', secure:true});
    peer.on('open', id => { if(matchRef) matchRef.child('players/'+fbUser.uid+'/peerId').set(id); });
    peer.on('connection', c => bindPeer(c));
    peer.on('call', call => {
        if(localMediaStream) call.answer(localMediaStream); else call.answer();
        call.on('stream', s => { remoteMediaStreams[call.peer] = s; attachRemote(call.peer, s); });
    });
};

window.bindPeer = function(c){
    peerConnections[c.peer] = c;
    c.on('data', m => {
        if(m && m.type==='game-action' && onlineHost){
            if(m.action==='roll' && players[current].uid===m.uid) rollDice();
            if(m.action==='move' && players[current].uid===m.uid && !moving && rolled) animateMove(players[current], m.index);
        }
    });
};

window.attachRemote = function(peerId, stream){
    let p = players.find(x=>x.peerId===peerId); if(!p) return;
    let v = document.getElementById('vid-'+p.color);
    if(v){ v.srcObject = stream; v.style.display = 'block'; v.play().catch(()=>{}); }
};

window.startMediaForOnline = async function(){
    if(currentMode!=='online' && currentMode!=='friends') return;
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try{
        if(!localMediaStream) localMediaStream = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
        let me = players[onlinePlayerIndex];
        if(me){
            let v = document.getElementById('vid-'+me.color);
            if(v){ v.srcObject = localMediaStream; v.muted = true; v.style.display = 'block'; v.play().catch(()=>{}); }
        }
        players.filter(p=>p&&p.active&&p.peerId&&p.peerId!==peer?.id).forEach(p=>{
            if(!peerConnections[p.peerId]){
                let c = peer.connect(p.peerId); bindPeer(c);
                let call = peer.call(p.peerId, localMediaStream);
                call.on('stream', s => { remoteMediaStreams[p.peerId] = s; attachRemote(p.peerId, s); });
            }
        });
    }catch(e){console.warn(e);}
};

window.toggleMedia = function(btn, type, color){
    btn.classList.toggle('off');
    if(currentMode!=='online' && currentMode!=='friends') return;
    startMediaForOnline().then(()=>{
        if(type==='cam' && localMediaStream) localMediaStream.getVideoTracks().forEach(t=>t.enabled = !btn.classList.contains('off'));
        if(type==='mic' && localMediaStream) localMediaStream.getAudioTracks().forEach(t=>t.enabled = !btn.classList.contains('off'));
        if(type==='speaker') Object.values(remoteMediaStreams).forEach(s=>{ [...document.querySelectorAll('video')].filter(v=>v.srcObject===s).forEach(v=>v.muted=btn.classList.contains('off')); });
    });
};

// --- CHAT ---
window.appendChat = function(m){
  const box = document.getElementById('chatMessages'); if(!box||!m)return;
  const d = document.createElement('div'); d.className='chat-msg';
  d.innerHTML='<b>'+String(m.name||'Player').replace(/[<>&]/g,'')+':</b> '+String(m.text||'').replace(/[<>&]/g,'');
  box.appendChild(d); box.scrollTop = box.scrollHeight;
};

window.sendChatMessage = function(){
  if(!matchRef || !fbUser) return;
  const input = document.getElementById('chatInput'); const text = (input.value||'').trim(); if(!text) return;
  const words = text.split(/\s+/).filter(Boolean);
  if(words.length>50){alert('Chat message maximum 50 words hai.');return;}
  if(!validUid(String(fbUser.uid||'')) || text.length > SECURITY_CONFIG.MAX_CHAT_CHARS) return; 
  matchRef.child('chat').push({ uid:fbUser.uid, name:String(userProfile.name||fbUser.displayName||'Player').slice(0,40), text:text.slice(0,SECURITY_CONFIG.MAX_CHAT_CHARS), ts:firebase.database.ServerValue.TIMESTAMP });
  input.value='';
};

// --- PROFILE CARD TOGGLE ---
window.toggleProfileCard = function(color){
  const p = players.find(x=>x.color===color); if(!p||!p.active)return;
  const modal = document.getElementById('playerProfileViewModal');
  const box = document.getElementById('playerProfileViewContent');
  const remote = remoteMediaStreams[p.peerId]; const local = (p.uid&&fbUser&&p.uid===fbUser.uid) ? localMediaStream : null; const stream = remote||local;
  
  let html = '<button class="closeBtn" onclick="document.getElementById(\'playerProfileViewModal\').classList.add(\'hide\')">X</button>'+
             '<div class="modalTitle">👤 '+String(p.name||'Player').replace(/[<>&]/g,'')+'</div>'+
             '<video id="profileVideo" class="profile-video" autoplay playsinline></video>'+ 
             '<div id="profileAvatarLarge" class="profile-avatar-large">'+(p.avatar||'👤')+'</div>'+
             '<div style="color:#aaa;text-align:center;font-size:13px;margin-bottom:12px;">'+(stream?'Live Video':'Camera Off')+'</div>';
  
  box.innerHTML = html;
  modal.classList.remove('hide');
  const v = document.getElementById('profileVideo'); const av = document.getElementById('profileAvatarLarge');
  if(stream){ v.srcObject = stream; v.style.display = 'block'; av.style.display = 'none'; v.play().catch(()=>{}); }
  else{ v.style.display = 'none'; av.style.display = 'flex'; }
};

document.getElementById('playerProfileViewModal').addEventListener('click', function(e){ if(e.target===this) this.classList.add('hide'); });
document.getElementById('profileModal').addEventListener('click', function(e){ if(e.target===this) this.classList.add('hide'); });

// --- CORE GAME LOGIC ---
window.startGame = function(isSim){
    let pc = parseInt(document.getElementById('playerCount').value,10);
    let feeValue = document.getElementById('entryFeeSelect').value;
    entryFee = feeValue==='any' ? 500 : parseInt(feeValue,10);
    
    if(currentMode==='online'){ startRealOnlineFromButton(); return; }
    
    if(totalCoins < entryFee){ alert('Not enough coins! Need '+entryFee+' 💰'); return; }
    totalCoins -= entryFee; localStorage.setItem('ludoCoins',totalCoins); loadCoins();
    
    let selected = pc===2 ? ['green','blue'] : (pc===3 ? ['green','yellow','blue'] : ['green','yellow','blue','red']);
    aiLevel = document.getElementById('aiDifficulty').value;
    
    players = selected.map((color,i)=>({
        id:i, color, name:i===0?userProfile.name:'AI '+COLOR_NAMES[color],
        avatar:i===0?userProfile.avatar:['🤖','🤖','🤖'][i-1]||'🤖',
        flag:i===0?userProfile.flag:'', cpu:i>0, aiLevel:aiLevel, tokens:[0,0,0,0], rank:0, offline:false, extraUsed:false, active:true, uid:'ai-'+i
    }));
    
    document.getElementById('startModal').classList.add('hide'); document.getElementById('homeScreen').style.display='none';
    document.getElementById('ludoGame').style.display='block';
    
    started = true; current = 0; ranks = []; turnSerial++;
    updatePlayersHUD(); renderTokens(); beginTurn();
};

window.getDiceHTML = function(val) {
   if(!val) return '<div class="dot center-dot"></div>';
   const d = { 1: ['center-dot'], 2: ['top-left', 'bottom-right'], 3: ['top-left', 'center-dot', 'bottom-right'], 4: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 5: ['top-left', 'top-right', 'center-dot', 'bottom-left', 'bottom-right'], 6: ['top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right'] };
   let html = ''; if(d[val]) d[val].forEach(pos => { html += '<div class="dot ' + pos + '"></div>'; }); return html;
};

window.createBoard = function(){
  cells.innerHTML = ''; const trackMap = {}; TRACK.forEach((p,i) => { trackMap[p[0]+'-'+p[1]] = i; });
  for(let r=0; r<15; r++){
    for(let c=0; c<15; c++){
      const el = document.createElement('div'); el.className = 'cell'; const key = r+'-'+c;
      if(trackMap[key] !== undefined){
        el.classList.add('path'); const index = trackMap[key];
        if(index === START_INDEX.green) el.classList.add('greenStart'); if(index === START_INDEX.yellow) el.classList.add('yellowStart');
        if(index === START_INDEX.blue) el.classList.add('blueStart'); if(index === START_INDEX.red) el.classList.add('redStart');
        if(SAFE.indexOf(index) !== -1) el.classList.add('star');
      }
      if(HOME_LANES.green.some(p=>p[0]===r && p[1]===c)) el.classList.add('lane','greenLane'); if(HOME_LANES.yellow.some(p=>p[0]===r && p[1]===c)) el.classList.add('lane','yellowLane');
      if(HOME_LANES.blue.some(p=>p[0]===r && p[1]===c)) el.classList.add('lane','blueLane'); if(HOME_LANES.red.some(p=>p[0]===r && p[1]===c)) el.classList.add('lane','redLane');
      cells.appendChild(el);
    }
  }
};

window.getGridPos = function(p, ti, tv) {
  if(tv === 0) return { top: HOME_POS[p.color][ti].t, left: HOME_POS[p.color][ti].l };
  if(tv === 57) { let m={red:{top:50,left:45},green:{top:45,left:50},yellow:{top:50,left:55},blue:{top:55,left:50}}; return m[p.color]; }
  if(tv >= 1 && tv <= 51) return TRACK[(START_INDEX[p.color] + tv - 1) % 52];
  if(tv >= 52 && tv <= 56) return HOME_LANES[p.color][tv - 52];
};

window.renderTokens = function(){
  tokenLayer.innerHTML = ''; let posMap = {};
  players.forEach(player => {
    if(!player.active) return;
    player.tokens.forEach((val, index) => {
      const token = document.createElement('div'); token.className = 'token ' + player.color;
      token.innerHTML = '<div class="pawn"><div class="pawnHead"></div><div class="pawnBody"></div><div class="pawnBase"></div></div>';
      
      let isM = (player.id === current && rolled && !moving && canMove(player, index, dice));
      
      token.addEventListener('click', (e) => { 
          e.stopPropagation(); 
          if(started && !rolling && rolled && !moving && player.id===current && canMove(player,index,dice)){
              if((currentMode==='online' || currentMode==='friends') && !onlineHost) sendAction('move',{index:index}); 
              else animateMove(player,index);
          } 
      });
      
      let pos = getGridPos(player, index, val); 
      let pk = pos.top!==undefined ? (val===57?'FINAL-'+player.color:val+'-'+player.color+'-'+index) : pos[0]+'-'+pos[1];
      if(!posMap[pk]) posMap[pk] = [];
      if(isM) token.classList.add('movable');
      posMap[pk].push({el:token, pos:pos, isM:isM, val:val});
    });
  });

  Object.keys(posMap).forEach(key => {
    let grp = posMap[key]; let cnt = grp.length;
    grp.forEach((item, i) => {
      let tPct = item.pos.top !== undefined ? item.pos.top : ((item.pos[0]+0.5)/15*100);
      let lPct = item.pos.top !== undefined ? item.pos.left : ((item.pos[1]+0.5)/15*100);
      item.el.style.top = tPct+'%'; item.el.style.left = lPct+'%';
      
      if(item.val === 0) {
          let offsets = [{x:-12, y:-12}, {x:12, y:-12}, {x:-12, y:12}, {x:12, y:12}];
          let off = offsets[i];
          item.el.style.transform = `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px)) scale(0.8)`;
      } else if(item.val===57) { 
          let offsets=[{x:-7,y:-7},{x:7,y:-7},{x:-7,y:7},{x:7,y:7}]; 
          let off=offsets[i%4]; 
          item.el.style.transform=`translate(calc(-50% + ${off.x}px),calc(-50% + ${off.y}px)) scale(.65)`; 
          item.el.style.zIndex=900+i; 
      } else if(cnt>1 && item.val<=56) { 
          let ox = [-10,10,-10,10][i%4]; let oy = [-10,10,10,-10][i%4]; 
          item.el.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px)) scale(0.65)`; 
      } else { 
          item.el.style.transform = `translate(-50%, -50%) scale(1)`; 
      }
      item.el.style.zIndex = item.isM ? 1000 : 50+i; 
      tokenLayer.appendChild(item.el);
    });
  });
};

window.canMove = function(player, index, roll){
 const pos = player.tokens[index];
 if(pos === 57) return false;
 if(pos === 0) return roll === 6;
 return pos + roll <= 57;
};

window.clearGameTimers = function(){
 clearInterval(turnTimer); turnTimer = null;
 if(cpuTimer){ clearTimeout(cpuTimer); cpuTimer = null; }
};

window.resetTurnFlags = function(){
 dice = 0; rolled = false; rolling = false; moving = false;
};

window.startTurnTimer = function(){
 if((currentMode==='online'||currentMode==='friends') && !onlineHost){ clearInterval(turnTimer); turnTimer=null; return; }
 clearInterval(turnTimer); turnTimer = null;

 COLORS.forEach(c => {
   const t = document.getElementById('timer-'+c);
   if(t){ t.style.strokeDashoffset = 176; t.classList.remove('danger'); }
 });

 const p = players[current];
 if(!p || !p.active || p.rank > 0 || !started) return;

 const myTurnSerial = turnSerial; timeLeft = 20;

 const actT = document.getElementById('timer-'+p.color);
 if(actT) actT.style.strokeDashoffset = 0;

 turnTimer = setInterval(() => {
   if(!started || myTurnSerial !== turnSerial) return;
   if(!players[current] || players[current].id !== p.id) return;
   if(moving || rolling) return;

   timeLeft--;

   if(actT){
     const maxTime = timeLeft > 20 ? 30 : 20;
     actT.style.strokeDashoffset = Math.max(0, 176 - (176 * (timeLeft / maxTime)));
     if(timeLeft <= 5) actT.classList.add('danger');
   }

   if(timeLeft <= 0){
     clearInterval(turnTimer); turnTimer = null;

     if((currentMode==='online'||currentMode==='friends') && onlineHost){
       turnMsg.textContent = 'Time Out! Turn passed.';
       nextTurn(); return;
     }

     if(!p.extraUsed && !p.cpu){
       p.extraUsed = true; timeLeft = 30; turnMsg.textContent = "Extra 30s Grace!";
       if(actT){ actT.style.strokeDashoffset = 0; actT.classList.remove('danger'); }
       turnTimer = setInterval(() => {
         if(!started || myTurnSerial !== turnSerial) return;
         if(moving || rolling) return;
         timeLeft--;
         if(actT){ actT.style.strokeDashoffset = Math.max(0, 176 - (176 * (timeLeft / 30))); if(timeLeft <= 5) actT.classList.add('danger'); }
         if(timeLeft <= 0){
           clearInterval(turnTimer); turnTimer = null;
           p.cpu = true; p.offline = true; document.getElementById('hud-'+p.color).classList.add('offline'); updatePlayersHUD();
           turnMsg.textContent = "Time Out! Auto Play.";
           cpuTimer = setTimeout(() => { if(started && players[current] && players[current].id === p.id) cpuPlay(); }, 500);
         }
       }, 1000);
     } else {
       p.cpu = true; p.offline = true; document.getElementById('hud-'+p.color).classList.add('offline'); updatePlayersHUD();
       turnMsg.textContent = "Time Out! Auto Play.";
       cpuTimer = setTimeout(() => { if(started && players[current] && players[current].id === p.id) cpuPlay(); }, 500);
     }
   }
 }, 1000);
};

window.updatePlayersHUD = function(){
 COLORS.forEach(c => {
   const hud = document.getElementById('hud-'+c);
   const p = players.find(x => x.color === c);
   hud.classList.remove('active','empty','offline');

   if(p && p.active){
     hud.style.opacity = '1';
     if(players[current] && players[current].color === c) hud.classList.add('active');
     if(p.offline) hud.classList.add('offline');
     document.getElementById('name-'+c).innerText = p.name + (p.flag ? " "+p.flag : "");
     document.querySelector('#av-'+c+' .emoji-av').textContent = p.avatar || '';
   }else{
     hud.style.opacity = '0.3'; hud.classList.add('empty');
   }
 });
};

window.beginTurn = function(){
    if(!started) return;
    clearGameTimers();
    let attempts = 0;
    while(attempts < players.length && (!players[current] || !players[current].active || players[current].rank > 0)){
       current = (current + 1) % players.length;
       attempts++;
    }
    const p = players[current];
    if(!p || p.rank > 0){ started = false; return; }

    resetTurnFlags(); turnSerial++;
    updatePlayersHUD();
    turnMsg.innerHTML = `<span style="color:${COLOR_HEX[p.color]}">${p.name}</span> turn`;

    COLORS.forEach(c => {
       const d = document.getElementById('dice-'+c);
       d.style.display = 'none'; d.classList.remove('active','rolling');
    });

    const activeD = document.getElementById('dice-'+p.color);
    activeD.style.display = 'block'; activeD.innerHTML = getDiceHTML(1); activeD.classList.add('active');

    startTurnTimer();

    if(p.cpu){
       const turnId = p.id; const ts = turnSerial;
       cpuTimer = setTimeout(() => {
         if(started && turnSerial === ts && players[current] && players[current].id === turnId && !rolling && !rolled && !moving){
             cpuPlay();
         }
       }, 700);
    }
};

COLORS.forEach(c => {
 document.getElementById('dice-'+c).addEventListener('click', () => {
   const p = players[current];
   if(started && p && p.color === c && !p.cpu && !rolling && !rolled && !moving){
     if((currentMode==='online'||currentMode==='friends') && !onlineHost){ sendAction('roll'); } else { rollDice(); }
   }
 });
});

window.rollDice = function(forceCpu=false){
 const p = players[current];
 if(!started || !p || p.rank > 0 || !p.active || (p.cpu && !forceCpu) || rolling || rolled || moving) return;

 rolling = true; clearInterval(turnTimer); playAudio('roll');

 const d = document.getElementById('dice-'+p.color);
 d.classList.add('rolling'); d.classList.remove('active');
 const myTs = turnSerial;

 let count = 0;
 const timer = setInterval(() => {
   if(!started || myTs !== turnSerial || players[current] !== p){ clearInterval(timer); rolling = false; return; }
   d.innerHTML = getDiceHTML(Math.floor(Math.random()*6)+1); count++;

   if(count >= 8){
     clearInterval(timer);
     let r = Math.floor(Math.random()*6) + 1;
     if(sixCount >= 2 && r === 6) r = Math.floor(Math.random()*5) + 1;
     dice = r; rolling = false;
     d.classList.remove('rolling'); d.classList.add('active');
     d.innerHTML = getDiceHTML(dice);
     document.getElementById('val-'+p.color).innerText = "Roll: "+dice;
     
     startTurnTimer();
     afterRoll(p, myTs);
     if(onlineHost) writeState();
   }
 },80);
};

window.afterRoll = function(playerAtRoll, expectedTs){
 if(!started || players[current] !== playerAtRoll || expectedTs !== turnSerial) return;

 rolled = true; const rollValue = dice;
 const moves = playerAtRoll.tokens.map((t,i) => canMove(playerAtRoll,i,rollValue) ? i : -1).filter(i => i !== -1);

 if(!moves.length){
   rolled = false; turnMsg.textContent = rollValue + " - No Move";
   if(rollValue === 6){
     sixCount++;
     if(sixCount >= 3){
       sixCount = 0; turnMsg.textContent = "3 Sixes - Turn Passed";
       setTimeout(() => { if(started && turnSerial===expectedTs) nextTurn(); }, 600);
     } else {
       setTimeout(() => { if(started && turnSerial===expectedTs) beginTurn(); }, 600);
     }
   } else {
     sixCount = 0;
     setTimeout(() => { if(started && turnSerial===expectedTs) nextTurn(); }, 600);
   }
   return;
 }

 if(moves.length === 1){
   turnMsg.textContent = "Auto Moving...";
   setTimeout(() => {
     if(started && turnSerial===expectedTs && players[current] === playerAtRoll && rolled && !moving){ animateMove(playerAtRoll, moves[0]); }
   }, 400);
 } else {
   turnMsg.textContent = rollValue + " - Select Token";
   renderTokens(); startTurnTimer();
 }
};

window.animateMove = function(player, index){
 if(!started || players[current] !== player || moving || !rolled || !canMove(player,index,dice)) return;
 const roll = dice; const startPos = player.tokens[index]; const myTs = turnSerial;

 moving = true; rolled = false; clearInterval(turnTimer);

 if(startPos === 0){
   player.tokens[index] = 1; renderTokens(); playAudio('move');
   setTimeout(() => { if(started && turnSerial===myTs) finalizeMove(player,index,startPos,roll,myTs); }, 300);
   return;
 }

 let cs = 0;
 const interval = setInterval(() => {
   if(!started || turnSerial!==myTs){ clearInterval(interval); moving = false; return; }
   player.tokens[index]++; cs++; renderTokens(); playAudio('move');
   if(cs >= roll){
     clearInterval(interval);
     setTimeout(() => { if(started && turnSerial===myTs) finalizeMove(player,index,startPos,roll,myTs); }, 250);
   }
 },200);
};

window.sendHomeAnimated = function(opponent, index, callback){
 let currentPos = opponent.tokens[index];
 const stepBack = setInterval(() => {
   if(currentPos > 1){ currentPos--; opponent.tokens[index] = currentPos; renderTokens(); }
   else{ clearInterval(stepBack); opponent.tokens[index] = 0; renderTokens(); if(callback) callback(); }
 },40);
};

window.finalizeMove = function(player, index, startPos, roll, expectedTs){
 if(!started || turnSerial !== expectedTs) return;
 const targets = captureTargets(player,index);
 const didCapture = targets.length > 0;

 if(didCapture){
   const ops = targets[0];
   sendHomeAnimated(players[ops.pId], ops.tId, () => {
     if(started && turnSerial===expectedTs) continueFinalize(player,index,startPos,roll,true,expectedTs);
   });
 } else {
   renderTokens();
   continueFinalize(player,index,startPos,roll,false,expectedTs);
 }
};

window.continueFinalize = function(player, index, startPos, roll, didCapture, expectedTs){
 if(!started || turnSerial !== expectedTs) return;
 const reachedHomeNow = startPos < 57 && player.tokens[index] === 57;

 if(player.tokens.every(x => x === 57) && player.rank === 0){
   player.rank = ranks.length + 1; ranks.push(player);
   const activeCount = players.filter(p => p.active).length;
   if(ranks.length >= activeCount - 1){ moving = false; setTimeout(endGame,500); return; }
 }

 moving = false;

 if(didCapture){ sixCount = 0; turnMsg.textContent = "Killed! Extra turn!"; beginTurn(); if(onlineHost) writeState(); return; }
 if(reachedHomeNow){ sixCount = 0; turnMsg.textContent = "Reached Home! Extra turn!"; beginTurn(); if(onlineHost) writeState(); return; }
 if(roll === 6){
   sixCount++;
   if(sixCount >= 3) { sixCount = 0; turnMsg.textContent = "3 Sixes! Turn passed."; nextTurn(); if(onlineHost) writeState(); return; }
   turnMsg.textContent = "Extra turn!"; beginTurn(); if(onlineHost) writeState(); return;
 }

 sixCount = 0;
 if(onlineHost) writeState();
 nextTurn();
};

window.captureTargets = function(player, tokenIndex){
 const myToken = player.tokens[tokenIndex]; if(myToken < 1 || myToken > 51) return [];
 const myAbsolute = (START_INDEX[player.color] + myToken - 1) % 52;
 if(SAFE.indexOf(myAbsolute) !== -1) return [];
 const targets = [];
 players.forEach((opponent,pIdx) => {
   if(opponent.id === player.id || !opponent.active) return;
   opponent.tokens.forEach((other,tIdx) => {
     if(other < 1 || other > 51) return;
     if(((START_INDEX[opponent.color] + other - 1) % 52) === myAbsolute){ targets.push({pId:pIdx,tId:tIdx}); }
   });
 });
 return targets;
};

window.nextTurn = function(){
 if(!started) return;
 current = (current + 1) % players.length;
 beginTurn();
 if(onlineHost) writeState();
};

window.aiScoreMove = function(p, i, level){
  const rollValue=dice, pos=p.tokens[i]; let score=Math.random()*3;
  if(pos===0 && rollValue===6) score+= level==='easy'?8:18;
  if(pos+rollValue===57) score+= level==='easy'?20:100;
  if(captureTargets(p,i).length) score+= level==='easy'?15:(level==='hard'?45:90);
  const next=pos===0?1:pos+rollValue;
  if(next>=1&&next<=51){const abs=(START_INDEX[p.color]+next-1)%52;if(SAFE.includes(abs))score+=level==='veryhard'?30:(level==='hard'?18:5);}
  if(pos>0&&pos<52) score+=level==='veryhard'?pos*0.35:(level==='hard'?pos*0.12:0);
  return score;
};

window.cpuPlay = function(){
 if(!started)return; const p=players[current]; if(!p||!p.active||p.rank>0||!p.cpu||rolling||rolled||moving)return;
 const level=(aiLevel||p.aiLevel||'easy').toLowerCase(); const turnId=p.id; const ts=turnSerial; const think=level==='easy'?350:(level==='hard'?650:900);
 rollDice(true);
 cpuTimer=setTimeout(()=>{
   cpuTimer=null;
   if(!started || ts!==turnSerial || players[current]!==p || !rolled || rolling || moving) return;
   const legal=p.tokens.map((t,i)=>canMove(p,i,dice)?i:-1).filter(i=>i>=0);
   if(!legal.length){ afterRoll(p, ts); return; }
   let choice;
   if(level==='easy') choice=legal[Math.floor(Math.random()*legal.length)];
   else if(level==='hard') choice=legal.slice().sort((a,b)=>aiScoreMove(p,b,'hard')-aiScoreMove(p,a,'hard'))[0];
   else choice=legal.slice().sort((a,b)=>aiScoreMove(p,b,'veryhard')-aiScoreMove(p,a,'veryhard'))[0];
   animateMove(p, choice);
 },think+900);
};

window.endGame = function() {
    started = false; clearGameTimers();
    let activePlayers = players.filter(p=>p.active);
    activePlayers.forEach(p => { if(p.rank === 0) { p.rank = activePlayers.length; ranks.push(p); } });
    
    let pool = entryFee * activePlayers.length;
    let rewards = [0, 0, 0, 0];
    if(activePlayers.length === 2) { rewards[0] = pool - (entryFee*0.1); } 
    else if(activePlayers.length === 3) { rewards[0] = entryFee*2; rewards[1] = entryFee*0.8; }
    else if(activePlayers.length === 4) { rewards[0] = entryFee*2.5; rewards[1] = entryFee*1; rewards[2] = entryFee*0.5; }
    
    let html = "";
    ranks.forEach((p, i) => { 
        html += `#${p.rank} ${String(p.name).replace(/[<>&]/g,'')} - Won ${rewards[i]}💰<br/>`; 
        if(p.id === 0 && !p.cpu && entryFee > 0) { 
            totalCoins += rewards[i]; 
            localStorage.setItem('ludoCoins', totalCoins); 
        }
    });
    
    document.getElementById('rankList').innerHTML = html;
    document.getElementById('winnerName').innerText = ranks[0].name + " Wins!";
    document.getElementById('winnerModal').classList.remove('hide');
};

/* INIT */
checkProfile(); 
createBoard();
})();
