/* =========================================================
   MESSY — APP.JS
   Dark social messenger
   Supabase-compatible with existing database
   ========================================================= */

const sb = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);


/* =========================================================
   STATE
   ========================================================= */

let me = null;
let selectedUser = null;

let channel = null;
let presenceChannel = null;

let authMode = "login";

let mediaRecorder = null;
let audioChunks = [];

let typingTimer = null;
let typingActive = false;

let usersCache = [];
let conversationCache = {};

let booted = false;


/* =========================================================
   HELPERS
   ========================================================= */

const $ = id => document.getElementById(id);

const authView = $("authView");
const chatView = $("chatView");
const authForm = $("authForm");

const userList = $("userList");
const messages = $("messages");
const messageInput = $("messageInput");

function initials(name) {
  return (name || "?")
    .trim()
    .slice(0, 2)
    .toUpperCase();
}

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char])
  );
}

function fmt(time) {
  if (!time) return "";

  return new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function fmtListTime(time) {
  if (!time) return "";

  const date = new Date(time);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function showError(message) {
  if ($("authMsg")) {
    $("authMsg").textContent = message || "";
  }
}

function showUploadStatus(message) {
  if ($("uploadStatus")) {
    $("uploadStatus").textContent = message || "";
  }
}

function setSendEnabled(enabled) {
  if ($("sendBtn")) {
    $("sendBtn").disabled = !enabled;
  }

  if (messageInput) {
    messageInput.disabled = !enabled;
  }
}

function scrollMessages() {
  if (!messages) return;

  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}


/* =========================================================
   AUTH TABS
   ========================================================= */

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {

    authMode = button.dataset.auth || "login";

    document
      .querySelectorAll(".tab")
      .forEach(tab => {
        tab.classList.toggle("active", tab === button);
      });

    if ($("username")) {
      $("username").classList.toggle(
        "hidden",
        authMode !== "signup"
      );
    }

    if ($("authButton")) {
      $("authButton").textContent =
        authMode === "signup"
          ? "Create account"
          : "Log in";
    }

    if ($("password")) {
      $("password").autocomplete =
        authMode === "signup"
          ? "new-password"
          : "current-password";
    }

    showError("");
  });
});


/* =========================================================
   AUTH
   ========================================================= */

if (authForm) {
  authForm.addEventListener("submit", async event => {

    event.preventDefault();

    showError("Working…");

    const email = $("email")?.value.trim();
    const password = $("password")?.value || "";

    try {

      if (!email || !password) {
        showError("Please enter your email and password.");
        return;
      }

      if (authMode === "login") {

        const { error } =
          await sb.auth.signInWithPassword({
            email,
            password
          });

        if (error) {
          showError(error.message);
        }

        return;
      }


      /* SIGN UP */

      const username =
        $("username")?.value.trim().toLowerCase();

      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        showError(
          "Username: 3–24 letters, numbers or _"
        );
        return;
      }

      const {
        data,
        error
      } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            username
          }
        }
      });

      if (error) {
        showError(error.message);
        return;
      }

      if (data?.user) {

        const { error: profileError } =
          await sb.from("profiles").upsert({
            id: data.user.id,
            username,
            display_name: username
          });

        if (profileError) {
          console.error(
            "Profile creation error:",
            profileError
          );
        }
      }

      showError(
        "Account created. Check your email if confirmation is enabled."
      );

    } catch (error) {

      console.error(error);

      showError(
        error?.message ||
        "Something went wrong. Please try again."
      );
    }
  });
}


/* =========================================================
   BOOT
   ========================================================= */

async function boot() {

  if (booted) return;

  booted = true;

  try {

    const { data, error } =
      await sb.auth.getSession();

    if (error) {
      console.error(error);
      return;
    }

    if (data.session?.user) {
      await enter(data.session.user);
    }

    sb.auth.onAuthStateChange(
      async (event, session) => {

        if (event === "SIGNED_OUT") {

          me = null;
          selectedUser = null;

          if (channel) {
            await sb.removeChannel(channel);
            channel = null;
          }

          if (presenceChannel) {
            await sb.removeChannel(
              presenceChannel
            );
            presenceChannel = null;
          }

          location.reload();
          return;
        }

        if (
          session?.user &&
          (
            event === "SIGNED_IN" ||
            event === "INITIAL_SESSION"
          )
        ) {
          await enter(session.user);
        }
      }
    );

  } catch (error) {

    console.error(
      "Boot error:",
      error
    );
  }
}


/* =========================================================
   ENTER APP
   ========================================================= */

async function enter(user) {

  me = user;

  if (!authView || !chatView) return;

  authView.classList.add("hidden");
  chatView.classList.remove("hidden");

  try {

    const {
      data: profile,
      error
    } = await sb
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error) {
      console.error(
        "Profile error:",
        error
      );
    }

    if ($("meLabel")) {
      $("meLabel").textContent =
        "@" +
        (
          profile?.username ||
          user.email ||
          "user"
        );
    }

    await sb
      .from("profiles")
      .update({
        is_online: true,
        last_seen: new Date().toISOString()
      })
      .eq("id", user.id);

    await loadUsers();

    setupPresence();

    window.addEventListener(
      "beforeunload",
      () => {

        if (!me) return;

        sb.from("profiles")
          .update({
            is_online: false,
            last_seen: new Date().toISOString()
          })
          .eq("id", me.id);
      }
    );

  } catch (error) {

    console.error(
      "Enter error:",
      error
    );
  }
}


/* =========================================================
   LOAD USERS
   ========================================================= */

async function loadUsers(query = "") {

  if (!me) return;

  try {

    let request = sb
      .from("profiles")
      .select(
        "id,username,display_name,is_online,last_seen"
      )
      .neq("id", me.id)
      .order("username");

    if (query) {
      request = request.ilike(
        "username",
        `%${query}%`
      );
    }

    const {
      data,
      error
    } = await request;

    if (error) {
      console.error(
        "User loading error:",
        error
      );

      userList.innerHTML = `
        <div class="empty">
          Unable to load users.
        </div>
      `;

      return;
    }

    usersCache = data || [];

    await loadConversationPreviews();

    renderUserList();

  } catch (error) {

    console.error(error);
  }
}


/* =========================================================
   CONVERSATION PREVIEWS
   ========================================================= */

async function loadConversationPreviews() {

  conversationCache = {};

  if (!me || !usersCache.length) return;

  try {

    const ids = usersCache.map(user => user.id);

    const {
      data,
      error
    } = await sb
      .from("messages")
      .select(
        "id,sender_id,receiver_id,content,message_type,created_at,seen_at"
      )
      .or(
        `sender_id.eq.${me.id},receiver_id.eq.${me.id}`
      )
      .order(
        "created_at",
        { ascending: false }
      );

    if (error) {
      console.error(
        "Conversation preview error:",
        error
      );
      return;
    }

    for (const message of data || []) {

      const otherId =
        message.sender_id === me.id
          ? message.receiver_id
          : message.sender_id;

      if (!ids.includes(otherId)) {
        continue;
      }

      if (!conversationCache[otherId]) {

        conversationCache[otherId] = {
          message,
          unread: 0
        };
      }

      if (
        message.receiver_id === me.id &&
        !message.seen_at
      ) {
        conversationCache[otherId].unread++;
      }
    }

  } catch (error) {

    console.error(error);
  }
}


/* =========================================================
   RENDER USER / MESSAGE LIST
   ========================================================= */

function renderUserList() {

  if (!userList) return;

  if (!usersCache.length) {

    userList.innerHTML = `
      <div class="empty">
        <div style="
          font-size:28px;
          margin-bottom:10px;
        ">👋</div>

        No other users yet.
      </div>
    `;

    return;
  }

  userList.innerHTML =
    usersCache.map(user => {

      const preview =
        conversationCache[user.id];

      const lastMessage =
        preview?.message;

      let previewText =
        lastMessage?.content || "";

      if (lastMessage?.message_type === "image") {
        previewText = "📷 Photo";
      }

      if (lastMessage?.message_type === "audio") {
        previewText = "🎤 Voice message";
      }

      if (!previewText) {
        previewText =
          user.is_online
            ? "Active now"
            : user.last_seen
              ? "Last seen " +
                fmtListTime(user.last_seen)
              : "No messages yet";
      }

      const unread =
        preview?.unread || 0;

      const active =
        selectedUser?.id === user.id;

      return `
        <button
          class="user ${active ? "active" : ""}"
          data-id="${esc(user.id)}"
          type="button"
        >

          <div class="avatar">
            ${esc(initials(user.username))}
          </div>

          <div class="user-info">

            <strong>
              @${esc(user.username)}
            </strong>

            <span>
              <i class="dot ${
                user.is_online
                  ? "online"
                  : ""
              }"></i>

              ${esc(previewText)}
            </span>

          </div>

          <div style="
            margin-left:auto;
            display:flex;
            flex-direction:column;
            align-items:flex-end;
            gap:6px;
            flex:none;
          ">

            ${
              lastMessage?.created_at
                ? `
                  <small style="
                    color:#686370;
                    font-size:9px;
                  ">
                    ${esc(
                      fmtListTime(
                        lastMessage.created_at
                      )
                    )}
                  </small>
                `
                : ""
            }

            ${
              unread > 0
                ? `
                  <span style="
                    min-width:19px;
                    height:19px;
                    padding:0 5px;
                    display:grid;
                    place-items:center;
                    border-radius:99px;
                    color:white;
                    background:#7657ff;
                    font-size:9px;
                    font-weight:800;
                  ">
                    ${
                      unread > 99
                        ? "99+"
                        : unread
                    }
                  </span>
                `
                : ""
            }

          </div>

        </button>
      `;

    }).join("");
}


/* =========================================================
   IMPORTANT:
   RELIABLE USER CLICK HANDLER
   ========================================================= */

if (userList) {

  userList.addEventListener(
    "click",
    async event => {

      const button =
        event.target.closest(".user");

      if (!button) return;

      const userId =
        button.dataset.id;

      if (!userId) return;

      const user =
        usersCache.find(
          item => item.id === userId
        );

      if (!user) {
        console.warn(
          "User not found:",
          userId
        );
        return;
      }

      await selectUser(user);
    }
  );
}


/* =========================================================
   SEARCH
   ========================================================= */

if ($("userSearch")) {

  let searchTimer = null;

  $("userSearch").addEventListener(
    "input",
    event => {

      clearTimeout(searchTimer);

      const query =
        event.target.value.trim();

      searchTimer = setTimeout(
        () => loadUsers(query),
        180
      );
    }
  );
}


/* =========================================================
   SELECT USER / OPEN CHAT
   ========================================================= */

async function selectUser(user) {

  if (!user || !me) return;

  selectedUser = user;

  $("chatName").textContent =
    "@" + user.username;

  $("chatAvatar").textContent =
    initials(user.username);

  updatePresenceText(user);

  setSendEnabled(true);

  $("typing")?.classList.add("hidden");

  /* Mobile */

  $("chatView")
    ?.querySelector(".chat")
    ?.classList.add("open");

  $("chatView")
    ?.querySelector(".sidebar")
    ?.classList.add("hide-mobile");

  /* Desktop visual update */

  renderUserList();

  try {

    await loadMessages();

    subscribeMessages();

    subscribeTyping();

  } catch (error) {

    console.error(
      "Select user error:",
      error
    );
  }

  messageInput?.focus();
}


/* =========================================================
   PRESENCE TEXT
   ========================================================= */

function updatePresenceText(user) {

  if (!$("presence")) return;

  if (user.is_online) {

    $("presence").innerHTML = `
      <span style="
        color:#39d98a;
        font-weight:700;
      ">
        ●
      </span>
      online
    `;

    return;
  }

  $("presence").textContent =
    user.last_seen
      ? "last seen " + fmt(user.last_seen)
      : "offline";
}


/* =========================================================
   LOAD MESSAGES
   ========================================================= */

async function loadMessages() {

  if (!me || !selectedUser) return;

  const {
    data,
    error
  } = await sb
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${me.id},receiver_id.eq.${selectedUser.id}),and(sender_id.eq.${selectedUser.id},receiver_id.eq.${me.id})`
    )
    .order(
      "created_at",
      { ascending: true }
    );

  if (error) {

    console.error(
      "Messages error:",
      error
    );

    messages.innerHTML = `
      <div class="empty">
        Couldn't load messages.
      </div>
    `;

    return;
  }

  messages.innerHTML = "";

  const list = data || [];

  if (!list.length) {

    messages.innerHTML = `
      <div class="empty">
        <div style="
          font-size:27px;
          margin-bottom:10px;
        ">
          ✨
        </div>

        Start the conversation.
      </div>
    `;

  } else {

    list.forEach(renderMessage);
  }

  scrollMessages();

  /* Mark received messages as seen */

  await sb
    .from("messages")
    .update({
      seen_at:
        new Date().toISOString()
    })
    .eq(
      "sender_id",
      selectedUser.id
    )
    .eq(
      "receiver_id",
      me.id
    )
    .is(
      "seen_at",
      null
    );

  /* Update sidebar */

  await loadUsers(
    $("userSearch")?.value.trim() || ""
  );
}


/* =========================================================
   RENDER MESSAGE
   ========================================================= */

function renderMessage(message) {

  if (!messages) return;

  const mine =
    message.sender_id === me.id;

  const row =
    document.createElement("div");

  row.className =
    "bubble-row " +
    (mine ? "mine" : "");

  let body = "";

  if (message.message_type === "image") {

    body = `
      <img
        src="${esc(message.file_url)}"
        alt="Image"
        loading="lazy"
      >
    `;

  } else if (
    message.message_type === "audio"
  ) {

    body = `
      <audio
        class="voice"
        controls
        preload="metadata"
        src="${esc(message.file_url)}"
      ></audio>
    `;

  } else {

    body = esc(message.content);
  }


  row.innerHTML = `
    <div class="bubble">

      ${body}

      <div class="meta">
        ${esc(fmt(message.created_at))}

        ${
          mine
            ? (
              message.seen_at
                ? " ✓✓"
                : " ✓"
            )
            : ""
        }
      </div>

      <div class="reactionbar">

        <button
          class="reaction"
          type="button"
          data-react="❤️"
          data-message="${esc(message.id)}"
        >
          ❤️
        </button>

        <button
          class="reaction"
          type="button"
          data-react="😂"
          data-message="${esc(message.id)}"
        >
          😂
        </button>

        <button
          class="reaction"
          type="button"
          data-react="👍"
          data-message="${esc(message.id)}"
        >
          👍
        </button>

        ${
          mine
            ? `
              <button
                class="reaction"
                type="button"
                data-delete="${esc(message.id)}"
              >
                🗑️
              </button>
            `
            : ""
        }

      </div>

    </div>
  `;


  /* Reaction buttons */

  row
    .querySelectorAll("[data-react]")
    .forEach(button => {

      button.addEventListener(
        "click",
        async event => {

          event.stopPropagation();

          await react(
            button.dataset.message,
            button.dataset.react
          );
        }
      );
    });


  /* Delete */

  const deleteButton =
    row.querySelector(
      "[data-delete]"
    );

  if (deleteButton) {

    deleteButton.addEventListener(
      "click",
      async event => {

        event.stopPropagation();

        await deleteMessage(
          deleteButton.dataset.delete
        );
      }
    );
  }

  messages.appendChild(row);
}


/* =========================================================
   SEND MESSAGE
   ========================================================= */

async function sendMessage(
  content,
  type = "text",
  file_url = null
) {

  if (!me || !selectedUser) return;

  const cleanContent =
    content || "";

  const {
    error
  } = await sb
    .from("messages")
    .insert({
      sender_id: me.id,
      receiver_id: selectedUser.id,
      content: cleanContent,
      message_type: type,
      file_url
    });

  if (error) {

    console.error(
      "Send message error:",
      error
    );

    alert(error.message);

    return false;
  }

  return true;
}


/* =========================================================
   SEND BUTTON
   ========================================================= */

if ($("sendBtn")) {

  $("sendBtn").addEventListener(
    "click",
    async () => {

      const value =
        messageInput?.value.trim();

      if (!value || !selectedUser) return;

      const sent =
        await sendMessage(value);

      if (sent) {

        messageInput.value = "";

        autoResizeTextarea();

        stopTyping();
      }
    }
  );
}


/* =========================================================
   ENTER TO SEND
   ========================================================= */

if (messageInput) {

  messageInput.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {

        event.preventDefault();

        $("sendBtn")?.click();
      }
    }
  );


  messageInput.addEventListener(
    "input",
    () => {

      autoResizeTextarea();

      if (
        !selectedUser ||
        !channel
      ) {
        return;
      }

      if (!typingActive) {

        typingActive = true;

        channel.send({
          type: "broadcast",
          event: "typing",
          payload: {
            user_id: me.id,
            typing: true
          }
        });
      }

      clearTimeout(typingTimer);

      typingTimer =
        setTimeout(
          stopTyping,
          900
        );
    }
  );
}


/* =========================================================
   TEXTAREA AUTO RESIZE
   ========================================================= */

function autoResizeTextarea() {

  if (!messageInput) return;

  messageInput.style.height = "auto";

  messageInput.style.height =
    Math.min(
      messageInput.scrollHeight,
      120
    ) + "px";
}


/* =========================================================
   STOP TYPING
   ========================================================= */

function stopTyping() {

  clearTimeout(typingTimer);

  if (
    !typingActive ||
    !channel
  ) {
    return;
  }

  typingActive = false;

  channel.send({
    type: "broadcast",
    event: "typing",
    payload: {
      user_id: me.id,
      typing: false
    }
  });
}


/* =========================================================
   REALTIME MESSAGES
   ========================================================= */

async function subscribeMessages() {

  if (!me || !selectedUser) return;

  if (channel) {

    try {
      await sb.removeChannel(channel);
    } catch (error) {
      console.warn(error);
    }

    channel = null;
  }


  const room =
    "chat-" +
    [me.id, selectedUser.id]
      .sort()
      .join("-");


  channel =
    sb.channel(room);


  channel.on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "messages"
    },
    async payload => {

      const message =
        payload.new;

      const relevant =
        (
          message.sender_id === me.id &&
          message.receiver_id === selectedUser.id
        ) ||
        (
          message.sender_id === selectedUser.id &&
          message.receiver_id === me.id
        );

      if (!relevant) return;


      /* Don't duplicate our own messages */

      const existing =
        [...messages.children]
          .some(row => {

            return row.dataset?.messageId ===
              message.id;
          });

      if (!existing) {

        const oldEmpty =
          messages.querySelector(
            ".empty"
          );

        if (oldEmpty) {
          oldEmpty.remove();
        }

        const before =
          messages.children.length;

        renderMessage(message);

        const row =
          messages.lastElementChild;

        if (row) {
          row.dataset.messageId =
            message.id;
        }

        if (before > 0) {
          scrollMessages();
        }
      }


      /* Mark incoming message seen */

      if (
        message.receiver_id === me.id
      ) {

        await sb
          .from("messages")
          .update({
            seen_at:
              new Date().toISOString()
          })
          .eq(
            "id",
            message.id
          );
      }


      /* Refresh conversation list */

      await loadUsers(
        $("userSearch")?.value.trim() || ""
      );
    }
  );


  channel.on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "messages"
    },
    async () => {

      await loadMessages();
    }
  );


  const status =
    await channel.subscribe();

  console.log(
    "Chat realtime:",
    room,
    status
  );
}


/* =========================================================
   TYPING REALTIME
   ========================================================= */

function subscribeTyping() {

  if (!channel || !selectedUser) return;

  channel.on(
    "broadcast",
    {
      event: "typing"
    },
    ({ payload }) => {

      if (
        payload?.user_id !==
        selectedUser.id
      ) {
        return;
      }

      $("typing")
        ?.classList.toggle(
          "hidden",
          !payload.typing
        );
    }
  );
}


/* =========================================================
   PRESENCE
   ========================================================= */

function setupPresence() {

  if (!me) return;

  if (presenceChannel) {

    sb.removeChannel(
      presenceChannel
    );

    presenceChannel = null;
  }


  presenceChannel =
    sb.channel(
      "messy-presence",
      {
        config: {
          presence: {
            key: me.id
          }
        }
      }
    );


  presenceChannel.on(
    "presence",
    {
      event: "sync"
    },
    async () => {

      await loadUsers(
        $("userSearch")?.value.trim() || ""
      );

      if (selectedUser) {

        const updated =
          usersCache.find(
            user =>
              user.id ===
              selectedUser.id
          );

        if (updated) {

          selectedUser =
            updated;

          updatePresenceText(
            updated
          );
        }
      }
    }
  );


  presenceChannel.subscribe(
    async status => {

      if (status === "SUBSCRIBED") {

        await presenceChannel.track({
          online_at:
            new Date().toISOString()
        });
      }
    }
  );
}


/* =========================================================
   DELETE MESSAGE
   ========================================================= */

async function deleteMessage(id) {

  if (!id || !me) return;

  const confirmed =
    confirm(
      "Delete this message?"
    );

  if (!confirmed) return;

  const {
    error
  } = await sb
    .from("messages")
    .delete()
    .eq("id", id)
    .eq("sender_id", me.id);

  if (error) {

    alert(error.message);

    return;
  }

  await loadMessages();
}


/* =========================================================
   REACTIONS
   ========================================================= */

async function react(
  messageId,
  reaction
) {

  if (!messageId || !me) return;

  const {
    error
  } = await sb
    .from("reactions")
    .upsert(
      {
        message_id: messageId,
        user_id: me.id,
        reaction
      },
      {
        onConflict:
          "message_id,user_id"
      }
    );

  if (error) {
    console.error(
      "Reaction error:",
      error
    );
  }
}


/* =========================================================
   LOGOUT
   ========================================================= */

if ($("logoutBtn")) {

  $("logoutBtn").addEventListener(
    "click",
    async () => {

      try {

        if (me) {

          await sb
            .from("profiles")
            .update({
              is_online: false,
              last_seen:
                new Date().toISOString()
            })
            .eq(
              "id",
              me.id
            );
        }

        await sb.auth.signOut();

      } catch (error) {

        console.error(
          "Logout error:",
          error
        );
      }
    }
  );
}


/* =========================================================
   MOBILE BACK
   ========================================================= */

if ($("backBtn")) {

  $("backBtn").addEventListener(
    "click",
    () => {

      $("chatView")
        ?.querySelector(".chat")
        ?.classList.remove("open");

      $("chatView")
        ?.querySelector(".sidebar")
        ?.classList.remove(
          "hide-mobile"
        );

      selectedUser = null;

      setSendEnabled(false);

      if ($("chatName")) {
        $("chatName").textContent =
          "Select a user";
      }

      if ($("presence")) {
        $("presence").textContent =
          "Choose someone to chat";
      }

      if ($("chatAvatar")) {
        $("chatAvatar").textContent = "?";
      }

      if (messageInput) {
        messageInput.value = "";
      }

      $("typing")
        ?.classList.add("hidden");
    }
  );
}


/* =========================================================
   IMAGE UPLOAD
   ========================================================= */

if ($("imageBtn")) {

  $("imageBtn").addEventListener(
    "click",
    () => {

      if (!selectedUser) {
        alert(
          "Choose someone to chat with first."
        );
        return;
      }

      $("imageInput")?.click();
    }
  );
}


if ($("imageInput")) {

  $("imageInput").addEventListener(
    "change",
    async event => {

      const file =
        event.target.files?.[0];

      if (
        !file ||
        !selectedUser ||
        !me
      ) {
        return;
      }

      try {

        showUploadStatus(
          "Uploading image…"
        );

        const safeName =
          file.name.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
          );

        const path =
          `${me.id}/${crypto.randomUUID()}-${safeName}`;


        const {
          error
        } = await sb
          .storage
          .from("chat-media")
          .upload(
            path,
            file,
            {
              contentType:
                file.type
            }
          );

        if (error) {

          showUploadStatus(
            error.message
          );

          return;
        }


        const {
          data
        } =
          sb
            .storage
            .from("chat-media")
            .getPublicUrl(path);


        await sendMessage(
          "",
          "image",
          data.publicUrl
        );

        showUploadStatus("");

      } catch (error) {

        console.error(error);

        showUploadStatus(
          "Image upload failed."
        );

      } finally {

        event.target.value = "";
      }
    }
  );
}


/* =========================================================
   VOICE RECORDING
   ========================================================= */

if ($("recordBtn")) {

  $("recordBtn").addEventListener(
    "click",
    async () => {

      if (!selectedUser) {

        alert(
          "Choose someone to chat with first."
        );

        return;
      }


      /* STOP */

      if (
        mediaRecorder &&
        mediaRecorder.state ===
        "recording"
      ) {

        mediaRecorder.stop();

        $("recordBtn")
          .classList
          .remove("recording");

        return;
      }


      /* START */

      try {

        const stream =
          await navigator
            .mediaDevices
            .getUserMedia({
              audio: true
            });


        audioChunks = [];

        mediaRecorder =
          new MediaRecorder(stream);


        mediaRecorder.ondataavailable =
          event => {

            if (
              event.data &&
              event.data.size > 0
            ) {
              audioChunks.push(
                event.data
              );
            }
          };


        mediaRecorder.onstop =
          async () => {

            stream
              .getTracks()
              .forEach(
                track =>
                  track.stop()
              );


            try {

              const blob =
                new Blob(
                  audioChunks,
                  {
                    type:
                      mediaRecorder.mimeType ||
                      "audio/webm"
                  }
                );


              if (!blob.size) {

                showUploadStatus("");

                return;
              }


              showUploadStatus(
                "Uploading voice message…"
              );


              const path =
                `${me.id}/${crypto.randomUUID()}.webm`;


              const {
                error
              } = await sb
                .storage
                .from("chat-media")
                .upload(
                  path,
                  blob,
                  {
                    contentType:
                      blob.type
                  }
                );


              if (error) {

                showUploadStatus(
                  error.message
                );

                return;
              }


              const {
                data
              } =
                sb
                  .storage
                  .from("chat-media")
                  .getPublicUrl(path);


              await sendMessage(
                "",
                "audio",
                data.publicUrl
              );


              showUploadStatus("");

            } catch (error) {

              console.error(error);

              showUploadStatus(
                "Voice upload failed."
              );
            }
          };


        mediaRecorder.start();

        $("recordBtn")
          .classList
          .add("recording");

      } catch (error) {

        console.error(error);

        alert(
          "Microphone permission was denied or is unavailable."
        );
      }
    }
  );
}


/* =========================================================
   SERVICE WORKER
   ========================================================= */

if ("serviceWorker" in navigator) {

  window.addEventListener(
    "load",
    () => {

      navigator.serviceWorker
        .register("sw.js")
        .catch(error => {
          console.warn(
            "Service worker registration failed:",
            error
          );
        });
    }
  );
}


/* =========================================================
   START
   ========================================================= */

boot();
