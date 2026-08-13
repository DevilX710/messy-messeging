import { supabase } from './supabase.js'
const { createClient } = supabase;
const sb = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

let me = null, selectedUser = null, channel = null, presenceChannel = null;
let authMode = "login", mediaRecorder = null, audioChunks = [], typingTimer = null;
const $ = id => document.getElementById(id);

const authView=$("authView"), chatView=$("chatView"), authForm=$("authForm");
const userList=$("userList"), messages=$("messages"), messageInput=$("messageInput");

function initials(name){return (name||"?").slice(0,2).toUpperCase()}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function fmt(t){return new Date(t).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}
function showError(s){$("authMsg").textContent=s||""}

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
  authMode=b.dataset.auth;
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));
  $("username").classList.toggle("hidden",authMode!=="signup");
  $("authButton").textContent=authMode==="signup"?"Create account":"Log in";
  $("password").autocomplete=authMode==="signup"?"new-password":"current-password";
  showError("");
});

authForm.onsubmit=async e=>{
  e.preventDefault(); showError("Working…");
  const email=$("email").value.trim(), password=$("password").value;
  if(authMode==="login"){
    const {error}=await sb.auth.signInWithPassword({email,password});
    if(error) showError(error.message);
  }else{
    const username=$("username").value.trim().toLowerCase();
    if(!/^[a-z0-9_]{3,24}$/.test(username)) return showError("Username: 3–24 letters, numbers or _");
    const {data,error}=await sb.auth.signUp({email,password,options:{data:{username}}});
    if(error) return showError(error.message);
    if(data.user) await sb.from("profiles").upsert({id:data.user.id,username,display_name:username});
    showError("Account created. Check your email if confirmation is enabled.");
  }
};

async function boot(){
  const {data}=await sb.auth.getSession();
  if(data.session) await enter(data.session.user);
  sb.auth.onAuthStateChange(async(event,session)=>{
    if(session) {
      await enter(session.user);
    } else if(event==="SIGNED_OUT") {
      location.reload();
    }
  });
}
async function enter(user){
  me=user;
  authView.classList.add("hidden"); chatView.classList.remove("hidden");
  const {data:profile}=await sb.from("profiles").select("*").eq("id",user.id).single();
  $("meLabel").textContent="@"+(profile?.username||user.email);
  await sb.from("profiles").update({is_online:true,last_seen:new Date().toISOString()}).eq("id",user.id);
  await loadUsers();
  setupPresence();
  window.addEventListener("beforeunload",()=>sb.from("profiles").update({is_online:false,last_seen:new Date().toISOString()}).eq("id",me.id));
}
async function loadUsers(query=""){
  let q=sb.from("profiles").select("id,username,display_name,is_online,last_seen").neq("id",me.id).order("username");
  if(query) q=q.ilike("username",`%${query}%`);
  const {data,error}=await q;
  if(error) return console.error(error);
  userList.innerHTML=(data||[]).map(u=>`
    <button class="user ${selectedUser?.id===u.id?"active":""}" data-id="${u.id}">
      <div class="avatar">${initials(u.username)}</div>
      <div class="user-info"><strong>@${esc(u.username)}</strong>
      <span><i class="dot ${u.is_online?"online":""}"></i>${u.is_online?"online":u.last_seen?"last seen "+fmt(u.last_seen):"offline"}</span></div>
    </button>`).join("") || `<div class="empty" style="padding:30px">No users found</div>`;
  userList.querySelectorAll(".user").forEach(b=>b.onclick=()=>selectUser(data.find(x=>x.id===b.dataset.id)));
}
$("userSearch").oninput=e=>loadUsers(e.target.value.trim());

async function selectUser(u){
  selectedUser=u; $("chatName").textContent="@"+u.username; $("chatAvatar").textContent=initials(u.username);
  $("presence").textContent=u.is_online?"online":u.last_seen?"last seen "+fmt(u.last_seen):"offline";
  messageInput.disabled=false; $("sendBtn").disabled=false;
  $("chatView").querySelector(".chat").classList.add("open");
  $("chatView").querySelector(".sidebar").classList.add("hide-mobile");
  await loadMessages(); subscribeMessages(); subscribeTyping();
}
async function loadMessages(){
  const {data,error}=await sb.from("messages").select("*")
    .or(`and(sender_id.eq.${me.id},receiver_id.eq.${selectedUser.id}),and(sender_id.eq.${selectedUser.id},receiver_id.eq.${me.id})`)
    .order("created_at",{ascending:true});
  if(error) return console.error(error);
  messages.innerHTML="";
  (data||[]).forEach(renderMessage);
  messages.scrollTop=messages.scrollHeight;
  await sb.from("messages").update({seen_at:new Date().toISOString()}).eq("sender_id",selectedUser.id).eq("receiver_id",me.id).is("seen_at",null);
}
function renderMessage(m){
  const mine=m.sender_id===me.id;
  const row=document.createElement("div"); row.className="bubble-row "+(mine?"mine":"");
  let body=m.message_type==="image"?`<img src="${esc(m.file_url)}" alt="Image">`:
    m.message_type==="audio"?`<audio class="voice" controls src="${esc(m.file_url)}"></audio>`:esc(m.content);
  row.innerHTML=`<div class="bubble">${body}<div class="meta">${fmt(m.created_at)} ${mine?(m.seen_at?"✓✓":"✓"):""}</div><div class="reactionbar">
    <button class="reaction" data-react="❤️">❤️</button><button class="reaction" data-react="😂">😂</button><button class="reaction" data-react="👍">👍</button>
    ${mine?`<button class="reaction" data-delete="${m.id}">🗑️</button>`:""}</div></div>`;
  row.querySelectorAll("[data-react]").forEach(b=>b.onclick=()=>react(m.id,b.dataset.react));
  const del=row.querySelector("[data-delete]"); if(del) del.onclick=()=>deleteMessage(m.id);
  messages.appendChild(row);
}
async function sendMessage(content,type="text",file_url=null){
  if(!selectedUser) return;
  const {error}=await sb.from("messages").insert({sender_id:me.id,receiver_id:selectedUser.id,content,message_type:type,file_url});
  if(error) alert(error.message);
}
$("sendBtn").onclick=()=>{const v=messageInput.value.trim();if(v){sendMessage(v);messageInput.value=""}};
messageInput.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("sendBtn").click()}};
messageInput.oninput=()=>{
  if(!selectedUser||!channel)return;
  channel.send({type:"broadcast",event:"typing",payload:{user_id:me.id,typing:true}});
  clearTimeout(typingTimer); typingTimer=setTimeout(()=>channel.send({type:"broadcast",event:"typing",payload:{user_id:me.id,typing:false}}),900);
};

function subscribeMessages(){
  if(channel) sb.removeChannel(channel);
  channel=sb.channel("chat-"+[me.id,selectedUser.id].sort().join("-"));
  channel.on("postgres_changes",{event:"INSERT",schema:"public",table:"messages"},payload=>{
    const m=payload.new;
    if((m.sender_id===me.id&&m.receiver_id===selectedUser.id)||(m.sender_id===selectedUser.id&&m.receiver_id===me.id)){renderMessage(m);messages.scrollTop=messages.scrollHeight;
      if(m.receiver_id===me.id) sb.from("messages").update({seen_at:new Date().toISOString()}).eq("id",m.id);
    }
  }).on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages"},()=>loadMessages())
  .subscribe();
}
function subscribeTyping(){
  channel.on("broadcast",{event:"typing"},({payload})=>{
    if(payload.user_id===selectedUser.id) $("typing").classList.toggle("hidden",!payload.typing);
  });
}
function setupPresence(){
  presenceChannel=sb.channel("presence",{config:{presence:{key:me.id}}});
  presenceChannel.on("presence",{event:"sync"},()=>loadUsers($("userSearch").value.trim())).subscribe(async status=>{
    if(status==="SUBSCRIBED") await presenceChannel.track({online_at:new Date().toISOString()});
  });
}
async function deleteMessage(id){
  const {error}=await sb.from("messages").delete().eq("id",id).eq("sender_id",me.id);
  if(error) alert(error.message);
}
async function react(id,reaction){
  await sb.from("reactions").upsert({message_id:id,user_id:me.id,reaction},{onConflict:"message_id,user_id"});
}

$("logoutBtn").onclick=async()=>{
  await sb.from("profiles").update({is_online:false,last_seen:new Date().toISOString()}).eq("id",me.id);
  await sb.auth.signOut();
};
$("backBtn").onclick=()=>{
  $("chatView").querySelector(".chat").classList.remove("open");
  $("chatView").querySelector(".sidebar").classList.remove("hide-mobile");
};
$("imageBtn").onclick=()=>$("imageInput").click();
$("imageInput").onchange=async e=>{
  const file=e.target.files[0]; if(!file||!selectedUser)return;
  $("uploadStatus").textContent="Uploading image…";
  const path=`${me.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
  const {error}=await sb.storage.from("chat-media").upload(path,file,{contentType:file.type});
  if(error){$("uploadStatus").textContent=error.message;return}
  const {data}=sb.storage.from("chat-media").getPublicUrl(path);
  await sendMessage("", "image", data.publicUrl);
  $("uploadStatus").textContent=""; e.target.value="";
};
$("recordBtn").onclick=async()=>{
  if(mediaRecorder?.state==="recording"){mediaRecorder.stop();$("recordBtn").classList.remove("recording");return}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    audioChunks=[]; mediaRecorder=new MediaRecorder(stream);
    mediaRecorder.ondataavailable=e=>audioChunks.push(e.data);
    mediaRecorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType||"audio/webm"});
      $("uploadStatus").textContent="Uploading voice message…";
      const path=`${me.id}/${crypto.randomUUID()}.webm`;
      const {error}=await sb.storage.from("chat-media").upload(path,blob,{contentType:blob.type});
      if(error){$("uploadStatus").textContent=error.message;return}
      const {data}=sb.storage.from("chat-media").getPublicUrl(path);
      await sendMessage("", "audio", data.publicUrl);
      $("uploadStatus").textContent="";
    };
    mediaRecorder.start(); $("recordBtn").classList.add("recording");
  }catch(e){alert("Microphone permission was denied or is unavailable.")}
};

if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js"));
boot();
