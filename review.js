// Collaborative review / teaching mode.
(() => {
  'use strict';

  const board = window.goBoardInstance;
  const canvas = board?.canvas;
  const SERVER = String(window.GO_NETWORK_SERVER_URL || '').replace(/\/$/, '');
  if (!board || !canvas) return;

  const RAINBOW = ['#e53935','#fb8c00','#fdd835','#43a047','#00acc1','#1e88e5','#8e24aa'];
  const MARK_TOOLS = new Set(['circle','square','triangle','cross','number','letter','color-square']);
  const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

  const state = {
    tool: null,
    items: [],
    participantIndex: 0,
    roomId: null,
    token: null,
    socket: null,
    connected: false,
    host: false,
    dragging: false,
    lastPoint: null,
    previewLine: null,
    number: 1,
    letter: 0,
    manualClose: false,
    reconnectTimer: null,
    reconnectAttempt: 0,
    connecting: false,
    heartbeatTimer: null,
    lastServerSeenAt: 0,
    connectedParticipants: 1,
    applyingRemote: false,
    lastBoardKey: ''
  };

  const css = document.createElement('style');
  css.textContent = `
    .reviewTools{display:grid;grid-template-columns:1fr 1fr;gap:7px}
    .reviewTools button{margin:0;background:#2d3136;border-color:#454b52;color:#eee}
    .reviewTools button.active{background:#b98645;border-color:#c49356;color:#15100a}
    .reviewColorRow{display:grid;grid-template-columns:1fr 42px;gap:8px;align-items:end;margin-top:9px}
    .reviewColorRow input[type=color]{width:42px;min-height:32px;height:32px;margin:0;padding:2px}
    .reviewActions,.reviewLinkBox{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:9px}
    .reviewActions button,.reviewLinkBox input,.reviewLinkBox button{margin:0}
    .reviewActions button.active{background:#b98645;border-color:#c49356;color:#15100a}
    .reviewStatus{margin-top:8px;padding:9px 10px;border:1px solid #34383d;border-radius:8px;background:#17191b;color:#c9ced3;font-size:11px;line-height:1.4}
    .reviewIdentity{display:flex;align-items:center;gap:7px;margin-top:8px;color:#aeb4ba;font-size:11px}
    .reviewDot{width:12px;height:12px;border-radius:50%;border:1px solid #111;box-shadow:0 0 0 1px #ffffff22}
    .reviewHint{margin-top:8px;color:#8f969d;font-size:10px;line-height:1.35}
    .review [hidden]{display:none!important}
  `;
  document.head.appendChild(css);

  const section = document.createElement('section');
  section.className = 'panel review';
  section.innerHTML = `
    <h2 class="panelHeading"><button class="panelToggle" type="button" aria-expanded="false" aria-controls="reviewPanelBody">Разбор</button></h2>
    <div id="reviewPanelBody" class="panelBody" hidden>
      <div class="reviewTools">
        <button type="button" data-review-tool="circle">Кружок</button>
        <button type="button" data-review-tool="square">Квадратик</button>
        <button type="button" data-review-tool="triangle">Треугольник</button>
        <button type="button" data-review-tool="cross">Крестик</button>
        <button type="button" data-review-tool="number">Цифра</button>
        <button type="button" data-review-tool="letter">Буква</button>
        <button type="button" data-review-tool="color-square">Цветной квадрат</button>
        <button type="button" data-review-tool="line">Линия</button>
      </div>
      <div class="reviewColorRow"><label>Цвет квадрата</label><input id="reviewSquareColor" type="color" value="#ffcc33"></div>
      <div class="reviewColorRow"><label>Цвет линии</label><input id="reviewLineColor" type="color" value="#e53935"></div>
      <div class="reviewActions">
        <button id="reviewUndo" class="secondary" type="button" data-review-tool="eraser" aria-pressed="false">Стереть</button>
        <button id="reviewClear" class="secondary" type="button">Очистить</button>
      </div>
      <button id="reviewCreate" type="button">Создать разбор</button>
      <button id="reviewLeave" class="secondary" type="button" hidden>Выйти из разбора</button>
      <div id="reviewLinkBox" class="reviewLinkBox" hidden>
        <input id="reviewLink" readonly>
        <button id="reviewCopy" class="secondary" type="button">Копировать</button>
      </div>
      <div class="reviewIdentity"><span id="reviewDot" class="reviewDot"></span><span id="reviewIdentity">Локальные метки</span></div>
      <div id="reviewStatus" class="reviewStatus">Выберите инструмент. Повторное нажатие выключает его.</div>
      <div class="reviewHint">Значки ставятся кликом или ведением мыши с зажатой кнопкой. Линия рисуется свободным движением.</div>
    </div>
  `;
  const anchor = document.querySelector('.modesPanel');
  if (anchor) anchor.insertAdjacentElement('afterend', section);
  else document.querySelector('.leftPanel')?.prepend(section);

  const q = s => section.querySelector(s);
  const toolButtons = [...section.querySelectorAll('[data-review-tool]')];
  const squareColor = q('#reviewSquareColor');
  const lineColor = q('#reviewLineColor');
  const undoButton = q('#reviewUndo');
  const clearButton = q('#reviewClear');
  const createButton = q('#reviewCreate');
  const leaveButton = q('#reviewLeave');
  const linkBox = q('#reviewLinkBox');
  const linkInput = q('#reviewLink');
  const copyButton = q('#reviewCopy');
  const statusBox = q('#reviewStatus');
  const dot = q('#reviewDot');
  const identity = q('#reviewIdentity');

  const participantColor = i => RAINBOW[((Number(i)||0) % RAINBOW.length + RAINBOW.length) % RAINBOW.length];
  const setStatus = text => statusBox.textContent = text;
  const safeColor = (value, fallback) => SAFE_COLOR.test(String(value||'')) ? String(value) : fallback;

  function updateIdentity() {
    dot.style.background = participantColor(state.participantIndex);
    identity.textContent = state.connected
      ? `Участник ${state.participantIndex + 1} · в комнате: ${state.connectedParticipants}`
      : 'Локальные метки';
  }
  updateIdentity();

  function setTool(tool) {
    state.tool = state.tool === tool ? null : tool;
    state.dragging = false;
    state.lastPoint = null;
    state.previewLine = null;
    toolButtons.forEach(b => {
      const active = b.dataset.reviewTool === state.tool;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    board.draw();
  }
  toolButtons.forEach(b => b.addEventListener('click', () => setTool(b.dataset.reviewTool)));

  function intersection(event, strict = true) {
    const { pad, step } = board.metrics();
    const rect = canvas.getBoundingClientRect();
    const fx = (event.clientX - rect.left - pad) / step;
    const fy = (event.clientY - rect.top - pad) / step;
    if (fx < -.5 || fy < -.5 || fx > board.size-.5 || fy > board.size-.5) return null;
    if (!strict) return { x: Math.max(0, Math.min(board.size-1, fx)), y: Math.max(0, Math.min(board.size-1, fy)) };
    const x = Math.round(fx), y = Math.round(fy);
    if (x < 0 || y < 0 || x >= board.size || y >= board.size) return null;
    return { x, y };
  }

  function nextLabel(tool) {
    if (tool === 'number') {
      const v = String(state.number);
      state.number = state.number >= 999 ? 1 : state.number + 1;
      return v;
    }
    if (tool === 'letter') {
      const v = String.fromCharCode(65 + state.letter);
      state.letter = (state.letter + 1) % 26;
      return v;
    }
    return '';
  }

  function send(payload) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return false;
    state.socket.send(JSON.stringify(payload));
    return true;
  }

  function localAdd(item) {
    if(item?.kind==='mark'){
      state.items=state.items.filter(existing=>!(
        existing?.kind==='mark' &&
        Number(existing.x)===Number(item.x) &&
        Number(existing.y)===Number(item.y)
      ));
    }
    state.items.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()),
      authorIndex: state.participantIndex,
      ...item
    });
    board.draw();
  }

  function addMark(point) {
    const item = {
      kind: 'mark',
      markType: state.tool,
      x: point.x,
      y: point.y,
      label: nextLabel(state.tool),
      fill: state.tool === 'color-square' ? safeColor(squareColor.value, '#ffcc33') : null
    };
    state.connected ? send({ type:'review-add', item }) : localAdd(item);
  }

  function finishLine() {
    const line = state.previewLine;
    state.previewLine = null;
    if (!line || line.points.length < 2) { board.draw(); return; }
    const item = { kind:'line', color:safeColor(line.color,'#e53935'), points:line.points.slice(0,1000) };
    state.connected ? send({ type:'review-add', item }) : localAdd(item);
    board.draw();
  }

  function pointerDown(event) {
    if (!state.tool || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (state.tool === 'eraser') {
      const p = intersection(event, false);
      if (p) eraseAt(p);
      state.dragging = false;
      state.lastPoint = null;
      return;
    }

    state.dragging = true;
    state.lastPoint = null;
    if (state.tool === 'line') {
      const p = intersection(event, false);
      if (p) state.previewLine = { color: lineColor.value, points:[p] };
      board.draw();
      return;
    }
    const p = intersection(event, true);
    if (!p) return;
    state.lastPoint = `${p.x},${p.y}`;
    addMark(p);
  }

  function pointerMove(event) {
    if (!state.tool || !state.dragging || !(event.buttons & 1)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state.tool === 'line') {
      const p = intersection(event, false);
      if (!p || !state.previewLine) return;
      const a = state.previewLine.points;
      const last = a[a.length-1];
      if (!last || Math.hypot(p.x-last.x,p.y-last.y) >= .08) {
        if (a.length < 1000) a.push(p);
        board.draw();
      }
      return;
    }
    const p = intersection(event, true);
    if (!p) return;
    const key = `${p.x},${p.y}`;
    if (key === state.lastPoint) return;
    state.lastPoint = key;
    addMark(p);
  }

  function pointerUp(event) {
    if (!state.dragging) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state.tool === 'line') finishLine();
    state.dragging = false;
    state.lastPoint = null;
  }

  canvas.addEventListener('pointerdown', pointerDown, true);
  canvas.addEventListener('pointermove', pointerMove, true);
  canvas.addEventListener('pointerup', pointerUp, true);
  canvas.addEventListener('pointercancel', pointerUp, true);
  canvas.addEventListener('mousemove', e => { if (state.tool) e.stopImmediatePropagation(); }, true);
  canvas.addEventListener('click', e => {
    if (!state.tool && !(state.connected && !state.host)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!state.tool && state.connected && !state.host) setStatus('Позицию меняет ведущий разбора. Вы можете ставить свои метки.');
  }, true);

  function outlinedPath(ctx, draw, author, width) {
    ctx.save();
    ctx.lineJoin='round';
    ctx.lineCap='round';
    ctx.strokeStyle='#111';
    ctx.lineWidth=width+1.4;
    draw(); ctx.stroke();
    ctx.strokeStyle=author;
    ctx.lineWidth=width;
    draw(); ctx.stroke();
    ctx.restore();
  }

  function drawMark(item,pad,step) {
    const c=board.ctx, cx=pad+item.x*step, cy=pad+item.y*step, r=step*.26;
    const author=participantColor(item.authorIndex), w=Math.max(1.1,step*.035);
    if (item.markType==='circle') outlinedPath(c,()=>{c.beginPath();c.arc(cx,cy,r,0,Math.PI*2)},author,w);
    else if (item.markType==='square') outlinedPath(c,()=>{c.beginPath();c.rect(cx-r,cy-r,2*r,2*r)},author,w);
    else if (item.markType==='triangle') outlinedPath(c,()=>{c.beginPath();c.moveTo(cx,cy-r*1.15);c.lineTo(cx+r,cy+r*.9);c.lineTo(cx-r,cy+r*.9);c.closePath()},author,w);
    else if (item.markType==='cross') outlinedPath(c,()=>{c.beginPath();c.moveTo(cx-r,cy-r);c.lineTo(cx+r,cy+r);c.moveTo(cx+r,cy-r);c.lineTo(cx-r,cy+r)},author,w);
    else if (item.markType==='color-square') {
      c.save();
      c.fillStyle=safeColor(item.fill,'#ffcc33'); c.fillRect(cx-r,cy-r,2*r,2*r);
      c.strokeStyle='#111';c.lineWidth=w+1.4;c.strokeRect(cx-r,cy-r,2*r,2*r);
      c.strokeStyle=author;c.lineWidth=w;c.strokeRect(cx-r,cy-r,2*r,2*r);c.restore();
    } else if (item.markType==='number'||item.markType==='letter') {
      c.save();
      const text=String(item.label||'?').slice(0,3);
      c.font=`800 ${Math.max(12,step*.42)}px Inter,system-ui,sans-serif`;
      c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';
      c.strokeStyle='#111';c.lineWidth=Math.max(2.4,step*.07);c.strokeText(text,cx,cy);
      c.strokeStyle=author;c.lineWidth=Math.max(1.1,step*.032);c.strokeText(text,cx,cy);
      c.fillStyle='#fff';c.fillText(text,cx,cy);c.restore();
    }
  }

  function drawLine(item,pad,step,preview=false) {
    const pts=item.points||[];
    if (pts.length<2) return;
    const c=board.ctx, author=preview?participantColor(state.participantIndex):participantColor(item.authorIndex);
    const path=()=>{c.beginPath();c.moveTo(pad+pts[0].x*step,pad+pts[0].y*step);for(let i=1;i<pts.length;i++)c.lineTo(pad+pts[i].x*step,pad+pts[i].y*step)};
    c.save();c.lineCap='round';c.lineJoin='round';c.globalAlpha=preview?.75:.92;
    c.strokeStyle=author;c.lineWidth=Math.max(3.2,step*.105);path();c.stroke();
    c.strokeStyle=safeColor(item.color,'#e53935');c.lineWidth=Math.max(2,step*.075);path();c.stroke();c.restore();
  }

  function drawLayer() {
    const {pad,step}=board.metrics();
    for(const item of state.items){
      if(item?.kind==='mark') drawMark(item,pad,step);
      else if(item?.kind==='line') drawLine(item,pad,step,false);
    }
    if(state.previewLine) drawLine(state.previewLine,pad,step,true);
  }

  const originalDraw=board.draw.bind(board);
  board.draw=function(...args){
    const result=originalDraw(...args);
    drawLayer();
    maybeBroadcastBoard();
    return result;
  };

  function boardSnapshot(){
    return {
      size:board.size,
      board:board.stones.slice(),
      captures:{black:Number(board.captures?.[1]||0),white:Number(board.captures?.[2]||0)},
      lastMove:board.lastMove?{...board.lastMove}:null
    };
  }
  const boardKey=s=>`${s.size}|${s.board.join('')}|${JSON.stringify(s.lastMove||null)}`;

  function maybeBroadcastBoard(){
    if(!state.connected||!state.host||state.applyingRemote) return;
    const snap=boardSnapshot(), key=boardKey(snap);
    if(key===state.lastBoardKey) return;
    state.lastBoardKey=key;
    send({type:'review-board',boardState:snap});
  }

  function applyRemoteBoard(snap){
    if(!snap||![9,13,19].includes(Number(snap.size))) return;
    const size=Number(snap.size);
    if(!Array.isArray(snap.board)||snap.board.length!==size*size) return;
    state.applyingRemote=true;
    try{
      if(board.size!==size) board.setSize(size);
      board.stones=snap.board.map(Number);
      board.captures={1:Number(snap.captures?.black||0),2:Number(snap.captures?.white||0)};
      board.lastMove=snap.lastMove?{x:Number(snap.lastMove.x),y:Number(snap.lastMove.y),stone:Number(snap.lastMove.stone||snap.lastMove.color||0)}:null;
      board.positionHistory=[board.positionKey()];
      board.history=[];
      state.lastBoardKey=boardKey(boardSnapshot());
      board.draw();
    } finally { state.applyingRemote=false; }
  }

  const storageKey=id=>`go-review-room:${id}`;
  function saveCredential(){
    if(!state.roomId||!state.token) return;
    localStorage.setItem(storageKey(state.roomId),JSON.stringify({token:state.token,participantIndex:state.participantIndex}));
  }
  function loadCredential(id){try{return JSON.parse(localStorage.getItem(storageKey(id))||'null')}catch(_){return null}}

  function reviewLink(id){
    const u=new URL(location.href);
    u.searchParams.delete('room');u.searchParams.set('review',id);u.hash='';
    return u.href;
  }
  function setReviewUrl(id){
    const u=new URL(location.href);
    if(id){u.searchParams.delete('room');u.searchParams.set('review',id)}else u.searchParams.delete('review');
    history.replaceState({},document.title,u.pathname+u.search+u.hash);
  }

  async function request(path,options={}){
    if(!SERVER) throw new Error('Сервер совместного разбора не настроен.');
    const r=await fetch(SERVER+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    let data=null;try{data=await r.json()}catch(_){}
    if(!r.ok) throw new Error(data?.error||`HTTP ${r.status}`);
    return data;
  }

  function acceptServerState(s){
    if(!s) return;
    if(Array.isArray(s.items)) state.items=s.items;
    state.connectedParticipants=Number(s.connectedParticipants||1);
    updateIdentity();
    if(!state.host&&s.boardState) applyRemoteBoard(s.boardState);
    board.draw();
  }

  const RECONNECT_DELAYS_MS=[150,500,1000,2000,4000,8000,15000];

  function stopHeartbeat(){
    if(state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    state.heartbeatTimer=null;
  }

  function startHeartbeat(ws){
    stopHeartbeat();
    state.lastServerSeenAt=Date.now();

    const beat=()=>{
      if(state.socket!==ws||ws.readyState!==WebSocket.OPEN) return;

      const now=Date.now();
      // В фоне браузеры могут сильно замедлять таймеры. Поэтому heartbeat
      // принудительно закрывает "зависший" сокет только когда вкладка активна.
      if(!document.hidden&&state.lastServerSeenAt&&now-state.lastServerSeenAt>50000){
        console.warn('[review] WebSocket heartbeat timeout; reconnecting');
        try{ws.close(4000,'heartbeat timeout')}catch(_){}
        return;
      }

      try{ws.send('ping')}
      catch(error){
        console.warn('[review] WebSocket ping failed',error);
        try{ws.close(4001,'ping failed')}catch(_){}
      }
    };

    beat();
    state.heartbeatTimer=setInterval(beat,20000);
  }

  function scheduleReconnect(immediate=false){
    if(!state.roomId||state.manualClose||state.connected||state.connecting) return;
    clearTimeout(state.reconnectTimer);

    const attempt=state.reconnectAttempt;
    const delay=immediate?0:RECONNECT_DELAYS_MS[Math.min(attempt,RECONNECT_DELAYS_MS.length-1)];
    state.reconnectAttempt=Math.min(attempt+1,RECONNECT_DELAYS_MS.length-1);

    setStatus(
      navigator.onLine
        ? (delay<=200?'Связь потеряна. Переподключаюсь…':`Связь потеряна. Новая попытка через ${Math.max(1,Math.ceil(delay/1000))} сек.`)
        : 'Нет интернета. Переподключение продолжится после восстановления сети.'
    );

    state.reconnectTimer=setTimeout(()=>{
      state.reconnectTimer=null;
      connectSocket().catch(error=>{
        if(state.manualClose||!state.roomId) return;
        console.warn('[review] Reconnect failed',error);
        scheduleReconnect(false);
      });
    },delay);
  }

  async function connectSocket(){
    if(state.connecting||state.connected||state.manualClose||!state.roomId||!state.token) return;
    state.connecting=true;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer=null;

    const wsBase=SERVER.replace(/^http/,'ws');
    const ws=new WebSocket(`${wsBase}/api/reviews/${encodeURIComponent(state.roomId)}/ws?token=${encodeURIComponent(state.token)}`);
    state.socket=ws;

    try{
      await new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(fn,value)=>{
          if(settled) return;
          settled=true;
          clearTimeout(t);
          fn(value);
        };
        const t=setTimeout(()=>finish(reject,new Error('Таймаут подключения')),8000);
        ws.addEventListener('open',()=>finish(resolve),{once:true});
        ws.addEventListener('error',()=>finish(reject,new Error('WebSocket не подключился')),{once:true});
      });
    }catch(error){
      state.connecting=false;
      if(state.socket===ws) state.socket=null;
      try{ws.close()}catch(_){}
      throw error;
    }

    if(state.manualClose||state.socket!==ws){
      state.connecting=false;
      try{ws.close(1000,'connection superseded')}catch(_){}
      return;
    }

    state.connecting=false;
    state.connected=true;
    state.reconnectAttempt=0;
    saveCredential();
    createButton.hidden=true;leaveButton.hidden=false;linkBox.hidden=false;
    linkInput.value=reviewLink(state.roomId);setReviewUrl(state.roomId);
    setStatus('Подключено к совместному разбору.');updateIdentity();
    startHeartbeat(ws);

    ws.addEventListener('message',e=>{
      if(state.socket!==ws) return;
      state.lastServerSeenAt=Date.now();

      // Cloudflare Durable Object отвечает на этот ping автоматически, не
      // пробуждая объект. Это поддерживает соединение через NAT/proxy.
      if(e.data==='pong') return;

      let msg;try{msg=JSON.parse(e.data)}catch(_){return}
      if(msg.type==='hello'){
        state.participantIndex=Number(msg.participantIndex||0);
        state.host=Boolean(msg.isHost);
        saveCredential();acceptServerState(msg.state);
        if(state.host){state.lastBoardKey=boardKey(boardSnapshot());send({type:'review-board',boardState:boardSnapshot()})}
      } else if(msg.type==='state') acceptServerState(msg.state);
      else if(msg.type==='error') setStatus('Сервер: '+msg.error);
    });

    ws.addEventListener('close',event=>{
      if(state.socket!==ws) return;
      stopHeartbeat();
      state.socket=null;
      state.connected=false;
      state.connecting=false;
      updateIdentity();

      console.warn('[review] WebSocket closed',{
        code:event.code,
        reason:event.reason||'',
        wasClean:event.wasClean
      });

      if(!state.manualClose) scheduleReconnect(false);
    });

    ws.addEventListener('error',event=>{
      if(state.socket===ws) console.warn('[review] WebSocket error',event);
    });
  }

  async function activateRoom(id,token,index=0){
    state.roomId=id;state.token=token;state.participantIndex=Number(index||0);
    state.host=state.participantIndex===0;state.manualClose=false;state.lastBoardKey=boardKey(boardSnapshot());
    saveCredential();await connectSocket();
  }

  async function createRoom(){
    createButton.disabled=true;setStatus('Создаю комнату разбора…');
    try{
      const r=await request('/api/reviews',{method:'POST',body:JSON.stringify({boardState:boardSnapshot(),items:state.items})});
      await activateRoom(r.roomId,r.participantToken,r.participantIndex);
      setStatus('Разбор создан. Отправьте ссылку участникам.');
    }catch(e){setStatus('Не удалось создать разбор: '+e.message)}
    finally{createButton.disabled=false}
  }

  async function joinRoom(id){
    if(!id) return;setStatus('Подключаюсь к разбору…');
    try{
      const saved=loadCredential(id);
      if(saved) await activateRoom(id,saved.token,saved.participantIndex);
      else {
        const r=await request(`/api/reviews/${encodeURIComponent(id)}/join`,{method:'POST',body:'{}'});
        await activateRoom(id,r.participantToken,r.participantIndex);
      }
    }catch(e){localStorage.removeItem(storageKey(id));setStatus('Не удалось войти в разбор: '+e.message)}
  }

  function leaveRoom(){
    state.manualClose=true;clearTimeout(state.reconnectTimer);stopHeartbeat();
    state.reconnectTimer=null;state.reconnectAttempt=0;state.connecting=false;
    try{state.socket?.close(1000,'user left')}catch(_){}
    state.socket=null;state.connected=false;state.roomId=null;state.token=null;state.host=false;state.connectedParticipants=1;
    createButton.hidden=false;leaveButton.hidden=true;linkBox.hidden=true;setReviewUrl(null);updateIdentity();
    setStatus('Вы вышли из совместного разбора. Метки остаются локально.');
  }

  function undoLast(){
    if(state.connected){send({type:'review-undo'});return}
    state.items.pop();
    board.draw();
  }

  function clearAll(){
    if(state.connected){send({type:'review-clear'});return}
    state.items=[];
    board.draw();
  }

  clearButton.addEventListener('click',clearAll);
  createButton.addEventListener('click',createRoom);
  leaveButton.addEventListener('click',leaveRoom);
  copyButton.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(linkInput.value);copyButton.textContent='Скопировано';setTimeout(()=>copyButton.textContent='Копировать',1200)}
    catch(_){linkInput.select();document.execCommand('copy')}
  });
  window.addEventListener('online',()=>{if(state.roomId&&!state.connected)scheduleReconnect(true)});
  window.addEventListener('offline',()=>{if(state.roomId&&!state.manualClose)setStatus('Нет интернета. Переподключение продолжится после восстановления сети.')});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden||!state.roomId||state.manualClose) return;
    if(state.socket?.readyState===WebSocket.OPEN){
      state.lastServerSeenAt=Date.now();
      try{state.socket.send('ping')}catch(_){}
    }else if(!state.connected){
      scheduleReconnect(true);
    }
  });

  const initialRoom=new URL(location.href).searchParams.get('review');
  if(initialRoom) joinRoom(initialRoom);

  window.goReview={state,setTool,createRoom,joinRoom,leaveRoom,undoLast,clearAll,eraseAt};
  board.draw();
})();
