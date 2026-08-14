/* =========================================================
   MESSY APP.JS
   Messages + Memes + Discover + Follow + Messy AI

   Compatible with older browsers / iPhone 6 style targets.
   OpenAI key NEVER belongs in this file.
   Messy AI connects to the secure Supabase Edge Function.
   ========================================================= */


/* =========================================================
   SUPABASE
   ========================================================= */

var sb = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);


/* =========================================================
   GLOBAL STATE
   ========================================================= */

var me = null;
var selectedUser = null;

var channel = null;
var presenceChannel = null;

var authMode = "login";

var usersCache = [];
var conversationCache = {};

var typingTimer = null;
var typingActive = false;

var mediaRecorder = null;
var audioChunks = [];

var booted = false;
var presenceTimer = null;


/* =========================================================
   HELPERS
   ========================================================= */

function $(id) {
  return document.getElementById(id);
}

function esc(value) {
  var s = String(value == null ? "" : value);

  return s.replace(/[&<>"']/g, function(c) {
    var map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return map[c];
  });
}

function initials(name) {
  return String(name || "?")
    .substring(0, 2)
    .toUpperCase();
}

function personName(profile) {
  if (!profile) return "User";

  return (
    profile.display_name ||
    profile.username ||
    "User"
  );
}

function fmt(time) {
  if (!time) return "";

  try {
    return new Date(time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (e) {
    return "";
  }
}

function randomName(prefix) {
  return (
    prefix +
    "-" +
    Date.now() +
    "-" +
    Math.floor(Math.random() * 1000000)
  );
}

function setAuthMessage(text) {
  if ($("authMsg")) {
    $("authMsg").textContent = text || "";
  }
}

function setUploadStatus(text) {
  if ($("uploadStatus")) {
    $("uploadStatus").textContent = text || "";
  }
}

function scrollMessages() {
  if (!$("messages")) return;

  setTimeout(function() {
    $("messages").scrollTop =
      $("messages").scrollHeight;
  }, 50);
}


/* =========================================================
   AUTH TABS
   ========================================================= */

var authTabs = document.querySelectorAll(".tab");

for (var at = 0; at < authTabs.length; at++) {

  authTabs[at].addEventListener("click", function() {

    authMode =
      this.getAttribute("data-auth") || "login";

    var allTabs =
      document.querySelectorAll(".tab");

    for (var i = 0; i < allTabs.length; i++) {
      allTabs[i].classList.toggle(
        "active",
        allTabs[i] === this
      );
    }

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

    setAuthMessage("");
  });
}


/* =========================================================
   AUTH
   ========================================================= */

if ($("authForm")) {

  $("authForm").addEventListener(
    "submit",
    async function(event) {

      event.preventDefault();

      var email =
        $("email").value.trim();

      var password =
        $("password").value;

      if (!email || !password) {
        setAuthMessage(
          "Please enter your email and password."
        );
        return;
      }

      setAuthMessage("Working…");

      try {

        if (authMode === "login") {

          var login =
            await sb.auth.signInWithPassword({
              email: email,
              password: password
            });

          if (login.error) {
            setAuthMessage(
              login.error.message
            );
            return;
          }

          return;
        }


        var username =
          $("username").value
            .trim()
            .toLowerCase();

        if (!/^[a-z0-9_]{3,24}$/.test(username)) {

          setAuthMessage(
            "Username must be 3–24 letters, numbers or _."
          );

          return;
        }


        var signup =
          await sb.auth.signUp({

            email: email,

            password: password,

            options: {
              data: {
                username: username
              }
            }

          });


        if (signup.error) {

          setAuthMessage(
            signup.error.message
          );

          return;
        }


        if (
          signup.data &&
          signup.data.user
        ) {

          await sb
            .from("profiles")
            .upsert({

              id: signup.data.user.id,

              username: username,

              display_name: username

            });

        }


        setAuthMessage(
          "Account created. Check your email if confirmation is enabled."
        );

      } catch (error) {

        console.log(
          "Auth error:",
          error
        );

        setAuthMessage(
          error && error.message
            ? error.message
            : "Something went wrong."
        );
      }

    }
  );

}


/* =========================================================
   BOOT
   ========================================================= */

async function boot() {

  if (booted) return;

  booted = true;

  try {

    var session =
      await sb.auth.getSession();


    if (
      session.data &&
      session.data.session &&
      session.data.session.user
    ) {

      await enter(
        session.data.session.user
      );

    }


    sb.auth.onAuthStateChange(
      async function(event, session) {

        if (
          session &&
          session.user &&
          (
            event === "SIGNED_IN" ||
            event === "INITIAL_SESSION"
          )
        ) {

          await enter(
            session.user
          );

        }


        if (event === "SIGNED_OUT") {

          me = null;
          selectedUser = null;

          if (channel) {

            try {
              await sb.removeChannel(channel);
            } catch (e) {}

            channel = null;
          }

          if (presenceChannel) {

            try {
              await sb.removeChannel(
                presenceChannel
              );
            } catch (e) {}

            presenceChannel = null;
          }

          window.location.reload();
        }

      }
    );

  } catch (error) {

    console.log(
      "Boot error:",
      error
    );

  }
}


/* =========================================================
   ENTER APP
   ========================================================= */

async function enter(user) {

  if (!user) return;

  me = user;

  if ($("authView")) {
    $("authView").classList.add("hidden");
  }

  if ($("chatView")) {
    $("chatView").classList.remove("hidden");
  }


  try {

    var profileResult =
      await sb
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();


    var profile =
      profileResult.data || {};


    if ($("meLabel")) {

      $("meLabel").textContent =
        "@" +
        (
          profile.username ||
          user.email ||
          "user"
        );

    }


    await sb
      .from("profiles")
      .update({

        is_online: true,

        last_seen:
          new Date().toISOString()

      })
      .eq("id", user.id);


    await loadUsers();

    setupPresence();


    if (presenceTimer) {
      clearInterval(presenceTimer);
    }


    presenceTimer =
      setInterval(
        updateMyPresence,
        60000
      );


    /* Start on Messages */

    showMessagesPage();

  } catch (error) {

    console.log(
      "Enter error:",
      error
    );

  }
}


async function updateMyPresence() {

  if (!me) return;

  await sb
    .from("profiles")
    .update({

      is_online: true,

      last_seen:
        new Date().toISOString()

    })
    .eq("id", me.id);
}


/* =========================================================
   USERS
   ========================================================= */

async function loadUsers(query) {

  if (!me) return;

  query = query || "";

  try {

    var request =
      sb
        .from("profiles")
        .select(
          "id,username,display_name,is_online,last_seen"
        )
        .neq("id", me.id)
        .order("username");


    if (query) {

      request =
        request.ilike(
          "username",
          "%" + query + "%"
        );

    }


    var result =
      await request;


    if (result.error) {

      console.log(
        "Users error:",
        result.error
      );

      if ($("userList")) {

        $("userList").innerHTML =
          '<div class="empty-users">Unable to load users.</div>';

      }

      return;
    }


    usersCache =
      result.data || [];


    await loadConversationPreviews();

    renderUsers();

  } catch (error) {

    console.log(
      "loadUsers:",
      error
    );

  }
}


async function loadConversationPreviews() {

  conversationCache = {};

  if (!me) return;


  try {

    var result =
      await sb
        .from("messages")
        .select(
          "id,sender_id,receiver_id,content,message_type,created_at,seen_at"
        )
        .or(
          "sender_id.eq." +
          me.id +
          ",receiver_id.eq." +
          me.id
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        );


    if (result.error) {

      console.log(
        "Preview error:",
        result.error
      );

      return;
    }


    var list =
      result.data || [];


    for (
      var i = 0;
      i < list.length;
      i++
    ) {

      var message =
        list[i];


      var otherId =
        message.sender_id === me.id
          ? message.receiver_id
          : message.sender_id;


      if (!conversationCache[otherId]) {

        conversationCache[otherId] = {

          message: message,

          unread: 0

        };

      }


      if (
        message.receiver_id === me.id &&
        !message.seen_at
      ) {

        conversationCache[
          otherId
        ].unread++;

      }

    }

  } catch (error) {

    console.log(
      "Preview error:",
      error
    );

  }
}


/* =========================================================
   RENDER USERS
   ========================================================= */

function renderUsers() {

  if (!$("userList")) return;


  if (!usersCache.length) {

    $("userList").innerHTML =
      '<div class="empty-users">No users found.</div>';

    return;
  }


  var html = "";


  for (
    var i = 0;
    i < usersCache.length;
    i++
  ) {

    var user =
      usersCache[i];


    var preview =
      conversationCache[user.id];


    var lastMessage =
      preview
        ? preview.message
        : null;


    var previewText = "";


    if (lastMessage) {

      if (
        lastMessage.message_type === "image"
      ) {

        previewText = "Photo";

      } else if (
        lastMessage.message_type === "audio"
      ) {

        previewText =
          "Voice message";

      } else {

        previewText =
          lastMessage.content || "";

      }

    }


    if (!previewText) {

      previewText =
        user.is_online
          ? "Active now"
          : "No messages yet";

    }


    var unread =
      preview
        ? preview.unread
        : 0;


    var active =
      selectedUser &&
      selectedUser.id === user.id;


    html +=

      '<button type="button" class="user ' +
      (active ? "active" : "") +
      '" data-id="' +
      esc(user.id) +
      '">' +

        '<div class="avatar">' +
          esc(initials(user.username)) +
        '</div>' +

        '<div class="user-info">' +

          '<strong>@' +
            esc(user.username) +
          '</strong>' +

          '<span>' +

            '<i class="dot ' +
              (
                user.is_online
                  ? "online"
                  : ""
              ) +
            '"></i>' +

            esc(previewText) +

          '</span>' +

        '</div>' +

        (
          unread > 0
            ? '<span class="unread-count">' +
                (
                  unread > 99
                    ? "99+"
                    : unread
                ) +
              '</span>'
            : ""
        ) +

      '</button>';

  }


  $("userList").innerHTML =
    html;
}


/* =========================================================
   USER SEARCH
   ========================================================= */

if ($("userSearch")) {

  $("userSearch").addEventListener(
    "input",
    function() {

      loadUsers(
        this.value.trim()
      );

    }
  );

}


/* =========================================================
   SELECT USER
   ========================================================= */

async function selectUser(user) {

  if (!user || !me) return;

  selectedUser = user;


  if ($("chatName")) {

    $("chatName").textContent =
      "@" + user.username;

  }


  if ($("chatAvatar")) {

    $("chatAvatar").textContent =
      initials(user.username);

  }


  updatePresenceText(user);


  if ($("messageInput")) {
    $("messageInput").disabled = false;
  }

  if ($("sendBtn")) {
    $("sendBtn").disabled = false;
  }


  var chat =
    document.querySelector(
      "main.chat"
    );

  var sidebar =
    document.querySelector(
      ".sidebar"
    );


  if (chat) {
    chat.classList.add("open");
  }

  if (sidebar) {
    sidebar.classList.add("hide-mobile");
  }


  renderUsers();

  await loadMessages();

  await subscribeMessages();

  subscribeTyping();


  if ($("messageInput")) {
    $("messageInput").focus();
  }
}


function updatePresenceText(user) {

  if (!user) return;


  if (user.is_online) {

    $("presence").innerHTML =
      '<span style="color:#3edc8a;">●</span> online';

  } else if (user.last_seen) {

    $("presence").textContent =
      "last seen " +
      fmt(user.last_seen);

  } else {

    $("presence").textContent =
      "offline";

  }
}


/* =========================================================
   USER CLICK
   ========================================================= */

if ($("userList")) {

  $("userList").addEventListener(
    "click",
    async function(event) {

      var target =
        event.target;


      while (
        target &&
        target !== $("userList") &&
        !target.classList.contains("user")
      ) {

        target =
          target.parentNode;

      }


      if (
        !target ||
        target === $("userList")
      ) {
        return;
      }


      var id =
        target.getAttribute(
          "data-id"
        );


      for (
        var i = 0;
        i < usersCache.length;
        i++
      ) {

        if (
          usersCache[i].id === id
        ) {

          await selectUser(
            usersCache[i]
          );

          break;

        }

      }

    }
  );

}


/* =========================================================
   LOAD MESSAGES
   ========================================================= */

async function loadMessages() {

  if (!me || !selectedUser) return;


  var result =
    await sb
      .from("messages")
      .select("*")
      .or(
        "and(sender_id.eq." +
        me.id +
        ",receiver_id.eq." +
        selectedUser.id +
        "),and(sender_id.eq." +
        selectedUser.id +
        ",receiver_id.eq." +
        me.id +
        ")"
      )
      .order(
        "created_at",
        {
          ascending: true
        }
      );


  if (result.error) {

    console.log(
      "Messages error:",
      result.error
    );

    if ($("messages")) {

      $("messages").innerHTML =
        '<div class="empty">' +
          '<strong>Could not load messages.</strong>' +
          '<span>Please try again.</span>' +
        '</div>';

    }

    return;
  }


  $("messages").innerHTML = "";


  var list =
    result.data || [];


  if (!list.length) {

    $("messages").innerHTML =
      '<div class="empty">' +
        '<div class="empty-icon">✦</div>' +
        '<strong>Start the conversation</strong>' +
        '<span>Send your first message.</span>' +
      '</div>';

  } else {

    for (
      var i = 0;
      i < list.length;
      i++
    ) {

      renderMessage(
        list[i]
      );

    }

  }


  scrollMessages();


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
}


/* =========================================================
   RENDER MESSAGE
   ========================================================= */

function renderMessage(message) {

  if (!$("messages") || !me)
    return;


  var mine =
    message.sender_id === me.id;


  var row =
    document.createElement(
      "div"
    );


  row.className =
    "bubble-row " +
    (mine ? "mine" : "");


  row.setAttribute(
    "data-message-id",
    message.id
  );


  var body = "";


  if (
    message.message_type === "image"
  ) {

    body =
      '<img src="' +
      esc(message.file_url) +
      '" alt="Image">';

  } else if (
    message.message_type === "audio"
  ) {

    body =
      '<audio class="voice" controls preload="metadata" src="' +
      esc(message.file_url) +
      '"></audio>';

  } else {

    body =
      esc(
        message.content || ""
      );

  }


  row.innerHTML =

    '<div class="bubble">' +

      body +

      '<div class="meta">' +

        esc(
          fmt(message.created_at)
        ) +

        (
          mine
            ? (
                message.seen_at
                  ? " ✓✓"
                  : " ✓"
              )
            : ""
        ) +

      '</div>' +

      '<div class="reactionbar">' +

        '<button type="button" class="reaction" data-react="❤️">♥</button>' +

        '<button type="button" class="reaction" data-react="😂">☺</button>' +

        '<button type="button" class="reaction" data-react="👍">+</button>' +

        (
          mine
            ? '<button type="button" class="reaction" data-delete="1">×</button>'
            : ""
        ) +

      '</div>' +

    '</div>';


  var reactions =
    row.querySelectorAll(
      "[data-react]"
    );


  for (
    var i = 0;
    i < reactions.length;
    i++
  ) {

    reactions[i].addEventListener(
      "click",
      (function(button) {

        return function(event) {

          event.stopPropagation();

          react(
            message.id,
            button.getAttribute(
              "data-react"
            )
          );

        };

      })(reactions[i])
    );

  }


  var deleteButton =
    row.querySelector(
      "[data-delete]"
    );


  if (deleteButton) {

    deleteButton.addEventListener(
      "click",
      function(event) {

        event.stopPropagation();

        deleteMessage(
          message.id
        );

      }
    );

  }


  $("messages").appendChild(
    row
  );
}


/* =========================================================
   SEND MESSAGE
   ========================================================= */

async function sendMessage(
  content,
  type,
  fileUrl
) {

  if (!me || !selectedUser)
    return false;


  var result =
    await sb
      .from("messages")
      .insert({

        sender_id:
          me.id,

        receiver_id:
          selectedUser.id,

        content:
          content || "",

        message_type:
          type || "text",

        file_url:
          fileUrl || null

      });


  if (result.error) {

    console.log(
      "Send message error:",
      result.error
    );

    alert(
      result.error.message
    );

    return false;
  }


  return true;
}


/* =========================================================
   CHAT SEND
   ========================================================= */

if ($("sendBtn")) {

  $("sendBtn").addEventListener(
    "click",
    async function() {

      if (!selectedUser)
        return;


      var value =
        $("messageInput")
          .value
          .trim();


      if (!value)
        return;


      var sent =
        await sendMessage(
          value,
          "text",
          null
        );


      if (sent) {

        $("messageInput")
          .value = "";

        autoResizeMessage();

        stopTyping();

      }

    }
  );

}


if ($("messageInput")) {

  $("messageInput").addEventListener(
    "keydown",
    function(event) {

      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {

        event.preventDefault();

        if ($("sendBtn")) {
          $("sendBtn").click();
        }

      }

    }
  );


  $("messageInput").addEventListener(
    "input",
    function() {

      autoResizeMessage();

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

            user_id:
              me.id,

            typing: true

          }

        });

      }


      clearTimeout(
        typingTimer
      );


      typingTimer =
        setTimeout(
          stopTyping,
          900
        );

    }
  );

}


function autoResizeMessage() {

  if (!$("messageInput"))
    return;


  $("messageInput").style.height =
    "auto";


  var h =
    $("messageInput").scrollHeight;


  if (h > 112)
    h = 112;


  $("messageInput").style.height =
    h + "px";
}


function stopTyping() {

  clearTimeout(
    typingTimer
  );


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

      user_id:
        me.id,

      typing: false

    }

  });
}


/* =========================================================
   REALTIME
   ========================================================= */

async function subscribeMessages() {

  if (!me || !selectedUser)
    return;


  if (channel) {

    try {
      await sb.removeChannel(
        channel
      );
    } catch (e) {}

    channel = null;
  }


  var room =
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
    async function(payload) {

      var message =
        payload.new;


      if (!message)
        return;


      var relevant =
        (
          message.sender_id === me.id &&
          message.receiver_id === selectedUser.id
        ) ||
        (
          message.sender_id === selectedUser.id &&
          message.receiver_id === me.id
        );


      if (!relevant)
        return;


      var existing =
        $("messages").querySelector(
          '[data-message-id="' +
          message.id +
          '"]'
        );


      if (!existing) {

        var empty =
          $("messages").querySelector(
            ".empty"
          );


        if (empty) {
          $("messages").innerHTML =
            "";
        }


        renderMessage(
          message
        );

        scrollMessages();

      }


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


      await loadUsers(
        $("userSearch")
          ? $("userSearch").value.trim()
          : ""
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
    function() {

      if (selectedUser) {
        loadMessages();
      }

    }
  );


  channel.subscribe(
    function(status) {

      console.log(
        "Messy realtime:",
        room,
        status
      );

    }
  );
}


function subscribeTyping() {

  if (
    !channel ||
    !selectedUser
  ) {
    return;
  }


  channel.on(
    "broadcast",
    {
      event: "typing"
    },
    function(event) {

      var payload =
        event.payload;


      if (!payload)
        return;


      if (
        payload.user_id !==
        selectedUser.id
      ) {
        return;
      }


      if ($("typing")) {

        $("typing").classList.toggle(
          "hidden",
          !payload.typing
        );

      }

    }
  );
}


/* =========================================================
   PRESENCE
   ========================================================= */

function setupPresence() {

  if (!me)
    return;


  if (presenceChannel) {

    try {
      sb.removeChannel(
        presenceChannel
      );
    } catch (e) {}

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
    function() {

      loadUsers(
        $("userSearch")
          ? $("userSearch").value.trim()
          : ""
      );

    }
  );


  presenceChannel.subscribe(
    async function(status) {

      if (
        status === "SUBSCRIBED"
      ) {

        await presenceChannel.track({
          online_at:
            new Date().toISOString()
        });

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
    function() {

      var chat =
        document.querySelector(
          "main.chat"
        );

      var sidebar =
        document.querySelector(
          ".sidebar"
        );


      if (chat) {
        chat.classList.remove(
          "open"
        );
      }

      if (sidebar) {
        sidebar.classList.remove(
          "hide-mobile"
        );
      }


      selectedUser = null;


      if ($("messageInput")) {
        $("messageInput").disabled =
          true;

        $("messageInput").value =
          "";
      }


      if ($("sendBtn")) {
        $("sendBtn").disabled =
          true;
      }


      if ($("chatName")) {
        $("chatName").textContent =
          "Select a user";
      }

      if ($("chatAvatar")) {
        $("chatAvatar").textContent =
          "?";
      }

      if ($("presence")) {
        $("presence").textContent =
          "Choose someone to chat";
      }

      if ($("typing")) {
        $("typing").classList.add(
          "hidden"
        );
      }


      renderUsers();

    }
  );

}


/* =========================================================
   IMAGE UPLOAD
   ========================================================= */

if ($("imageBtn")) {

  $("imageBtn").addEventListener(
    "click",
    function() {

      if (!selectedUser) {

        alert(
          "Choose someone to chat with first."
        );

        return;
      }


      $("imageInput").click();

    }
  );

}


if ($("imageInput")) {

  $("imageInput").addEventListener(
    "change",
    async function(event) {

      var file =
        event.target.files &&
        event.target.files[0];


      if (
        !file ||
        !selectedUser ||
        !me
      ) {
        return;
      }


      try {

        setUploadStatus(
          "Uploading image…"
        );


        var safeName =
          file.name.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
          );


        var path =
          me.id +
          "/" +
          randomName("image") +
          "-" +
          safeName;


        var upload =
          await sb.storage
            .from("chat-media")
            .upload(
              path,
              file,
              {
                contentType:
                  file.type
              }
            );


        if (upload.error) {

          setUploadStatus(
            upload.error.message
          );

          return;
        }


        var publicResult =
          sb.storage
            .from("chat-media")
            .getPublicUrl(
              path
            );


        var publicUrl =
          publicResult.data &&
          publicResult.data.publicUrl
            ? publicResult.data.publicUrl
            : null;


        if (!publicUrl) {

          setUploadStatus(
            "Could not create image URL."
          );

          return;
        }


        await sendMessage(
          "",
          "image",
          publicUrl
        );


        setUploadStatus("");

      } catch (error) {

        console.log(
          "Image error:",
          error
        );

        setUploadStatus(
          "Image upload failed."
        );

      } finally {

        event.target.value = "";

      }

    }
  );

}


/* =========================================================
   VOICE
   ========================================================= */

function voiceSupported() {

  return !!(
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia &&
    window.MediaRecorder
  );

}


if ($("recordBtn")) {

  if (!voiceSupported()) {

    $("recordBtn").disabled =
      true;

    $("recordBtn").title =
      "Voice recording is unavailable on this device.";

  }


  $("recordBtn").addEventListener(
    "click",
    async function() {

      if (!voiceSupported()) {

        alert(
          "Voice recording is not supported on this device."
        );

        return;
      }


      if (!selectedUser) {

        alert(
          "Choose someone to chat with first."
        );

        return;
      }


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


      try {

        var stream =
          await navigator.mediaDevices
            .getUserMedia({
              audio: true
            });


        audioChunks = [];


        mediaRecorder =
          new MediaRecorder(
            stream
          );


        mediaRecorder.ondataavailable =
          function(event) {

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
          async function() {

            stream
              .getTracks()
              .forEach(
                function(track) {
                  track.stop();
                }
              );


            try {

              var mime =
                mediaRecorder.mimeType ||
                "audio/webm";


              var blob =
                new Blob(
                  audioChunks,
                  {
                    type: mime
                  }
                );


              if (!blob.size)
                return;


              setUploadStatus(
                "Uploading voice message…"
              );


              var extension =
                mime.indexOf("mp4") !== -1
                  ? "m4a"
                  : "webm";


              var path =
                me.id +
                "/" +
                randomName(
                  "voice"
                ) +
                "." +
                extension;


              var upload =
                await sb.storage
                  .from("chat-media")
                  .upload(
                    path,
                    blob,
                    {
                      contentType:
                        mime
                    }
                  );


              if (upload.error) {

                setUploadStatus(
                  upload.error.message
                );

                return;
              }


              var publicResult =
                sb.storage
                  .from("chat-media")
                  .getPublicUrl(
                    path
                  );


              var publicUrl =
                publicResult.data &&
                publicResult.data.publicUrl
                  ? publicResult.data.publicUrl
                  : null;


              if (publicUrl) {

                await sendMessage(
                  "",
                  "audio",
                  publicUrl
                );

              }


              setUploadStatus("");

            } catch (error) {

              console.log(
                "Voice error:",
                error
              );

              setUploadStatus(
                "Voice upload failed."
              );

            }

          };


        mediaRecorder.start();


        $("recordBtn")
          .classList
          .add("recording");

      } catch (error) {

        console.log(
          "Microphone error:",
          error
        );

        alert(
          "Microphone permission was denied or is unavailable."
        );

      }

    }
  );

}


/* =========================================================
   DELETE MESSAGE
   ========================================================= */

async function deleteMessage(id) {

  if (!id || !me)
    return;


  if (
    !window.confirm(
      "Delete this message?"
    )
  ) {
    return;
  }


  var result =
    await sb
      .from("messages")
      .delete()
      .eq("id", id)
      .eq("sender_id", me.id);


  if (result.error) {

    alert(
      result.error.message
    );

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

  if (!messageId || !me)
    return;


  var result =
    await sb
      .from("reactions")
      .upsert(
        {
          message_id:
            messageId,

          user_id:
            me.id,

          reaction:
            reaction
        },
        {
          onConflict:
            "message_id,user_id"
        }
      );


  if (result.error) {

    console.log(
      "Reaction error:",
      result.error
    );

  }
}


/* =========================================================
   LOGOUT
   ========================================================= */

if ($("logoutBtn")) {

  $("logoutBtn").addEventListener(
    "click",
    async function() {

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

    }
  );

}


/* =========================================================
   MAIN NAVIGATION
   ========================================================= */

var memesPage =
  $("memesPage");

var discoverPage =
  $("discoverPage");

var aiPage =
  $("aiPage");

var messagesTabBtn =
  $("messagesTabBtn");

var memesTabBtn =
  $("memesTabBtn");

var discoverTabBtn =
  $("discoverTabBtn");

var aiTabBtn =
  $("aiTabBtn");

var chatMain =
  document.querySelector(
    "main.chat"
  );

var searchWrap =
  document.querySelector(
    ".search-wrap"
  );

var sideTitle =
  $("sidePageTitle");


function navActive(button) {

  var buttons =
    document.querySelectorAll(
      ".main-nav-item"
    );


  for (
    var i = 0;
    i < buttons.length;
    i++
  ) {

    buttons[i].classList.toggle(
      "active",
      buttons[i] === button
    );

  }
}


function hideAllPages() {

  if (memesPage) {
    memesPage.classList.add(
      "hidden"
    );
  }

  if (discoverPage) {
    discoverPage.classList.add(
      "hidden"
    );
  }

  if (aiPage) {
    aiPage.classList.add(
      "hidden"
    );
  }

  if (chatMain) {
    chatMain.classList.add(
      "hidden"
    );
  }

}


function showMessagesPage() {

  hideAllPages();


  if (chatMain) {
    chatMain.classList.remove(
      "hidden"
    );
  }


  if (searchWrap) {
    searchWrap.style.display =
      "block";
  }


  if (sideTitle) {
    sideTitle.textContent =
      "Messages";
  }


  navActive(
    messagesTabBtn
  );

}


if (messagesTabBtn) {

  messagesTabBtn.addEventListener(
    "click",
    showMessagesPage
  );

}


if (memesTabBtn) {

  memesTabBtn.addEventListener(
    "click",
    function() {

      hideAllPages();


      if (memesPage) {
        memesPage.classList.remove(
          "hidden"
        );
      }


      if (searchWrap) {
        searchWrap.style.display =
          "none";
      }


      if (sideTitle) {
        sideTitle.textContent =
          "Memes";
      }


      navActive(
        memesTabBtn
      );


      loadMemes();

    }
  );

}


if (discoverTabBtn) {

  discoverTabBtn.addEventListener(
    "click",
    function() {

      hideAllPages();


      if (discoverPage) {
        discoverPage.classList.remove(
          "hidden"
        );
      }


      if (searchWrap) {
        searchWrap.style.display =
          "none";
      }


      if (sideTitle) {
        sideTitle.textContent =
          "Discover";
      }


      navActive(
        discoverTabBtn
      );


      loadDiscover();

    }
  );

}


if (aiTabBtn) {

  aiTabBtn.addEventListener(
    "click",
    function() {

      hideAllPages();


      if (aiPage) {
        aiPage.classList.remove(
          "hidden"
        );
      }


      if (searchWrap) {
        searchWrap.style.display =
          "none";
      }


      if (sideTitle) {
        sideTitle.textContent =
          "Messy AI";
      }


      navActive(
        aiTabBtn
      );


      focusAI();

    }
  );

}


/* =========================================================
   MEMES
   ========================================================= */

var memeData = [];

var memeLoaded = false;

var memeLoading = false;

var memeCategory = "hot";


var fallbackMemes = [

  {
    id: "1",
    name: "Drake Hotline Bling",
    url: "https://i.imgflip.com/30b1gx.jpg"
  },

  {
    id: "2",
    name: "Distracted Boyfriend",
    url: "https://i.imgflip.com/1ur9b0.jpg"
  },

  {
    id: "3",
    name: "Two Buttons",
    url: "https://i.imgflip.com/1g8my4.jpg"
  },

  {
    id: "4",
    name: "Change My Mind",
    url: "https://i.imgflip.com/24y43o.jpg"
  },

  {
    id: "5",
    name: "One Does Not Simply",
    url: "https://i.imgflip.com/1bij.jpg"
  },

  {
    id: "6",
    name: "Always Has Been",
    url: "https://i.imgflip.com/46e43q.jpg"
  }

];


function memeMatchesCategory(meme) {

  var name =
    String(
      meme.name || ""
    ).toLowerCase();


  if (memeCategory === "hot")
    return true;


  if (memeCategory === "funny") {

    return (
      name.indexOf("drake") !== -1 ||
      name.indexOf("boyfriend") !== -1 ||
      name.indexOf("blinking") !== -1 ||
      name.indexOf("funny") !== -1 ||
      name.indexOf("office") !== -1
    );

  }


  if (memeCategory === "reaction") {

    return (
      name.indexOf("reaction") !== -1 ||
      name.indexOf("face") !== -1 ||
      name.indexOf("drake") !== -1 ||
      name.indexOf("cry") !== -1 ||
      name.indexOf("angry") !== -1
    );

  }


  if (memeCategory === "gaming") {

    return (
      name.indexOf("game") !== -1 ||
      name.indexOf("gaming") !== -1 ||
      name.indexOf("gamer") !== -1 ||
      name.indexOf("minecraft") !== -1 ||
      name.indexOf("pokemon") !== -1
    );

  }


  if (memeCategory === "random") {

    return (
      name.indexOf("random") !== -1 ||
      name.indexOf("mind") !== -1 ||
      name.indexOf("simply") !== -1 ||
      name.indexOf("buttons") !== -1
    );

  }


  return true;
}


function renderMemes() {

  var grid =
    $("memeGrid");


  if (!grid)
    return;


  var search =
    $("memeSearch")
      ? $("memeSearch")
          .value
          .trim()
          .toLowerCase()
      : "";


  var results = [];


  for (
    var i = 0;
    i < memeData.length;
    i++
  ) {

    var meme =
      memeData[i];


    var name =
      String(
        meme.name || ""
      ).toLowerCase();


    if (
      search &&
      name.indexOf(search) === -1
    ) {
      continue;
    }


    if (
      !memeMatchesCategory(
        meme
      )
    ) {
      continue;
    }


    results.push(
      meme
    );

  }


  if (!results.length) {

    grid.innerHTML =
      '<div class="meme-loading">' +
      'No memes found 😭' +
      '</div>';

    return;
  }


  var html = "";


  for (
    var j = 0;
    j < results.length;
    j++
  ) {

    var m =
      results[j];


    html +=

      '<article class="meme-card" data-meme-index="' +
      j +
      '">' +

        '<div class="meme-image-wrap">' +

          '<img class="meme-image" src="' +
          esc(m.url) +
          '" alt="' +
          esc(m.name) +
          '">' +

          '<div class="meme-actions">' +

            '<button class="meme-action" type="button">♡</button>' +

          '</div>' +

        '</div>' +

        '<div class="meme-info">' +

          '<span class="meme-title">' +
            esc(m.name) +
          '</span>' +

          '<div class="meme-meta">' +
            "Tap to open" +
          '</div>' +

        '</div>' +

      '</article>';

  }


  grid.innerHTML =
    html;
}


async function loadMemes(force) {

  if (
    memeLoaded &&
    !force
  ) {

    renderMemes();

    return;

  }


  if (memeLoading)
    return;


  memeLoading = true;


  if ($("memeGrid")) {

    $("memeGrid").innerHTML =
      '<div class="meme-loading">' +
      'Finding memes…' +
      '</div>';

  }


  var xhr =
    new XMLHttpRequest();


  xhr.open(
    "GET",
    "https://api.imgflip.com/get_memes",
    true
  );


  xhr.timeout =
    12000;


  xhr.onreadystatechange =
    function() {

      if (
        xhr.readyState !== 4
      ) {
        return;
      }


      memeLoading = false;


      if (
        xhr.status >= 200 &&
        xhr.status < 300
      ) {

        try {

          var data =
            JSON.parse(
              xhr.responseText
            );


          if (
            data.success &&
            data.data &&
            data.data.memes
          ) {

            memeData =
              data.data.memes;

            memeLoaded =
              true;

            renderMemes();

            return;
          }

        } catch (e) {

          console.log(
            "Meme parse error:",
            e
          );

        }

      }


      memeData =
        fallbackMemes;

      memeLoaded =
        true;

      renderMemes();

    };


  xhr.onerror =
    function() {

      memeLoading = false;

      memeData =
        fallbackMemes;

      memeLoaded =
        true;

      renderMemes();

    };


  xhr.ontimeout =
    function() {

      memeLoading = false;

      memeData =
        fallbackMemes;

      memeLoaded =
        true;

      renderMemes();

    };


  xhr.send();

}


var memeChips =
  document.querySelectorAll(
    "#memeCategories .chip"
  );


for (
  var mc = 0;
  mc < memeChips.length;
  mc++
) {

  memeChips[mc].addEventListener(
    "click",
    function() {

      for (
        var k = 0;
        k < memeChips.length;
        k++
      ) {

        memeChips[k]
          .classList
          .remove(
            "active"
          );

      }


      this.classList.add(
        "active"
      );


      memeCategory =
        this.getAttribute(
          "data-category"
        ) || "hot";


      renderMemes();

    }
  );

}


if ($("memeSearch")) {

  $("memeSearch").addEventListener(
    "input",
    function() {

      renderMemes();

    }
  );

}


if ($("refreshMemes")) {

  $("refreshMemes").addEventListener(
    "click",
    function() {

      memeLoaded = false;

      loadMemes(true);

    }
  );

}


/* Meme opening */

if ($("memeGrid")) {

  $("memeGrid").addEventListener(
    "click",
    function(event) {

      var card =
        event.target;


      while (
        card &&
        card !== $("memeGrid") &&
        !card.classList.contains(
          "meme-card"
        )
      ) {

        card =
          card.parentNode;

      }


      if (
        !card ||
        card === $("memeGrid")
      ) {
        return;
      }


      var index =
        parseInt(
          card.getAttribute(
            "data-meme-index"
          ),
          10
        );


      var search =
        $("memeSearch")
          ? $("memeSearch")
              .value
              .trim()
              .toLowerCase()
          : "";


      var results = [];


      for (
        var i = 0;
        i < memeData.length;
        i++
      ) {

        var m =
          memeData[i];


        var name =
          String(
            m.name || ""
          ).toLowerCase();


        if (
          search &&
          name.indexOf(search) === -1
        ) {
          continue;
        }


        if (
          !memeMatchesCategory(m)
        ) {
          continue;
        }


        results.push(m);

      }


      var meme =
        results[index];


      if (!meme)
        return;


      if (
        event.target.classList.contains(
          "meme-action"
        )
      ) {

        event.stopPropagation();

        event.target.textContent =
          event.target.textContent ===
          "♡"
            ? "♥"
            : "♡";

        return;
      }


      openMemeModal(
        meme
      );

    }
  );

}


function openMemeModal(meme) {

  var modal =
    document.createElement(
      "div"
    );


  modal.className =
    "meme-modal open";


  modal.innerHTML =

    '<div class="meme-modal-content">' +

      '<button class="meme-modal-close" type="button">×</button>' +

      '<img class="meme-modal-image" src="' +
      esc(meme.url) +
      '" alt="' +
      esc(meme.name) +
      '">' +

      '<div class="meme-modal-tools">' +

        '<button class="meme-send-chat" type="button">' +
          'Send to current chat' +
        '</button>' +

      '</div>' +

    '</div>';


  document.body.appendChild(
    modal
  );


  modal.querySelector(
    ".meme-modal-close"
  ).onclick =
    function() {

      if (modal.parentNode) {
        modal.parentNode.removeChild(
          modal
        );
      }

    };


  modal.querySelector(
    ".meme-send-chat"
  ).onclick =
    async function() {

      if (!selectedUser) {

        this.textContent =
          "Open a chat first";

        return;
      }


      this.disabled =
        true;

      this.textContent =
        "Sending…";


      var ok =
        await sendMessage(
          "😂 " +
          meme.name +
          "\n" +
          meme.url,
          "text",
          null
        );


      if (ok) {

        if (modal.parentNode) {
          modal.parentNode.removeChild(
            modal
          );
        }

      } else {

        this.disabled =
          false;

        this.textContent =
          "Try again";

      }

    };

}


/* =========================================================
   DISCOVER / FOLLOW
   ========================================================= */

var followingMap = {};

var followerCount = 0;

var followingCount = 0;


async function loadFollowState() {

  if (!me)
    return;


  followingMap = {};


  var following =
    await sb
      .from("follows")
      .select(
        "following_id"
      )
      .eq(
        "follower_id",
        me.id
      );


  if (!following.error) {

    var rows =
      following.data || [];


    for (
      var i = 0;
      i < rows.length;
      i++
    ) {

      followingMap[
        rows[i].following_id
      ] = true;

    }

  }


  var followingTotal =
    await sb
      .from("follows")
      .select(
        "id",
        {
          count: "exact",
          head: true
        }
      )
      .eq(
        "follower_id",
        me.id
      );


  followingCount =
    followingTotal.count || 0;


  var followerTotal =
    await sb
      .from("follows")
      .select(
        "id",
        {
          count: "exact",
          head: true
        }
      )
      .eq(
        "following_id",
        me.id
      );


  followerCount =
    followerTotal.count || 0;
}


async function loadDiscover() {

  if (!me)
    return;


  try {

    await loadFollowState();

    await renderNetworkCard();

    await loadSuggestions();

  } catch (error) {

    console.log(
      "Discover error:",
      error
    );

  }
}


async function renderNetworkCard() {

  var el =
    $("myNetwork");


  if (!el)
    return;


  var result =
    await sb
      .from("profiles")
      .select(
        "username,display_name"
      )
      .eq(
        "id",
        me.id
      )
      .single();


  var profile =
    result.data || {};


  el.innerHTML =

    '<div class="network-name">' +
      esc(
        personName(profile)
      ) +
    '</div>' +

    '<div class="network-handle">@' +
      esc(
        profile.username || ""
      ) +
    '</div>' +

    '<div class="network-stats">' +

      '<button class="network-stat" id="showFollowers" type="button">' +
        '<strong>' +
          followerCount +
        '</strong>' +
        '<span>Followers</span>' +
      '</button>' +

      '<button class="network-stat" id="showFollowing" type="button">' +
        '<strong>' +
          followingCount +
        '</strong>' +
        '<span>Following</span>' +
      '</button>' +

    '</div>';


  if ($("showFollowers")) {

    $("showFollowers").onclick =
      function() {

        openNetwork(
          "followers"
        );

      };

  }


  if ($("showFollowing")) {

    $("showFollowing").onclick =
      function() {

        openNetwork(
          "following"
        );

      };

  }
}


async function loadSuggestions() {

  if (!$("suggestionList"))
    return;


  var query =
    $("discoverSearch")
      ? $("discoverSearch")
          .value
          .trim()
      : "";


  if ($("suggestionStatus")) {
    $("suggestionStatus").textContent =
      "Loading…";
  }


  var request =
    sb
      .from("profiles")
      .select(
        "id,username,display_name,is_online,last_seen"
      )
      .neq(
        "id",
        me.id
      )
      .order(
        "username"
      )
      .limit(50);


  if (query) {

    request =
      request.ilike(
        "username",
        "%" + query + "%"
      );

  }


  var result =
    await request;


  if (result.error) {

    $("suggestionList").innerHTML =
      '<div class="meme-loading">' +
      'Could not load people.' +
      '</div>';

    return;
  }


  var people =
    result.data || [];


  var html = "";


  for (
    var i = 0;
    i < people.length;
    i++
  ) {

    html +=
      personCard(
        people[i]
      );

  }


  $("suggestionList").innerHTML =
    html ||
    '<div class="meme-loading">No people found.</div>';


  if ($("suggestionStatus")) {
    $("suggestionStatus").textContent =
      "";
  }


  bindPersonButtons();
}


function personCard(profile) {

  var following =
    !!followingMap[
      profile.id
    ];


  return

    '<div class="person-card" data-person="' +
    esc(profile.id) +
    '">' +

      '<div class="person-avatar">' +
        esc(
          initials(
            personName(profile)
          )
        ) +
      '</div>' +

      '<div class="person-info">' +

        '<strong>' +
          esc(
            personName(profile)
          ) +
        '</strong>' +

        '<span>@' +
          esc(
            profile.username || ""
          ) +

          (
            profile.is_online
              ? " · Online"
              : ""
          ) +

        '</span>' +

      '</div>' +

      '<button class="follow-btn ' +
        (
          following
            ? "following"
            : ""
        ) +
        '" type="button" data-follow="' +
        esc(profile.id) +
        '">' +

        (
          following
            ? "Following"
            : "Follow"
        ) +

      '</button>' +

    '</div>';
}


function bindPersonButtons() {

  var buttons =
    document.querySelectorAll(
      "[data-follow]"
    );


  for (
    var i = 0;
    i < buttons.length;
    i++
  ) {

    buttons[i].onclick =
      toggleFollow;

  }


  var cards =
    document.querySelectorAll(
      ".person-card"
    );


  for (
    var j = 0;
    j < cards.length;
    j++
  ) {

    cards[j].onclick =
      function(event) {

        if (
          event.target &&
          event.target.getAttribute(
            "data-follow"
          )
        ) {
          return;
        }


        var id =
          this.getAttribute(
            "data-person"
          );


        for (
          var z = 0;
          z < usersCache.length;
          z++
        ) {

          if (
            usersCache[z].id === id
          ) {

            selectUser(
              usersCache[z]
            );

            break;
          }

        }

      };

  }
}


async function toggleFollow(event) {

  event.stopPropagation();


  var button =
    event.currentTarget;


  var id =
    button.getAttribute(
      "data-follow"
    );


  if (
    !id ||
    id === me.id
  ) {
    return;
  }


  button.disabled =
    true;


  var alreadyFollowing =
    !!followingMap[id];


  var result;


  if (alreadyFollowing) {

    result =
      await sb
        .from("follows")
        .delete()
        .eq(
          "follower_id",
          me.id
        )
        .eq(
          "following_id",
          id
        );

  } else {

    result =
      await sb
        .from("follows")
        .insert({

          follower_id:
            me.id,

          following_id:
            id

        });

  }


  if (result.error) {

    console.log(
      "Follow error:",
      result.error
    );

    button.disabled =
      false;

    return;
  }


  await loadDiscover();
}


async function openNetwork(type) {

  if (
    !$("networkPanel") ||
    !$("networkList")
  ) {
    return;
  }


  $("networkPanel")
    .classList
    .remove("hidden");


  if ($("networkPanelTitle")) {

    $("networkPanelTitle")
      .textContent =
        type === "followers"
          ? "Followers"
          : "Following";

  }


  $("networkList").innerHTML =
    '<div class="meme-loading">Loading…</div>';


  var result;


  if (type === "followers") {

    result =
      await sb
        .from("follows")
        .select(
          "follower_id,profiles:follower_id(id,username,display_name,is_online,last_seen)"
        )
        .eq(
          "following_id",
          me.id
        );

  } else {

    result =
      await sb
        .from("follows")
        .select(
          "following_id,profiles:following_id(id,username,display_name,is_online,last_seen)"
        )
        .eq(
          "follower_id",
          me.id
        );

  }


  if (result.error) {

    $("networkList").innerHTML =
      '<div class="meme-loading">' +
      'Could not load this list.' +
      '</div>';

    return;
  }


  var rows =
    result.data || [];


  var html = "";


  for (
    var i = 0;
    i < rows.length;
    i++
  ) {

    if (rows[i].profiles) {

      html +=
        personCard(
          rows[i].profiles
        );

    }

  }


  $("networkList").innerHTML =
    html ||
    '<div class="meme-loading">Nobody here yet.</div>';


  bindPersonButtons();
}


if ($("discoverSearch")) {

  $("discoverSearch").addEventListener(
    "input",
    function() {

      loadDiscover();

    }
  );

}


if ($("closeNetwork")) {

  $("closeNetwork").onclick =
    function() {

      $("networkPanel")
        .classList
        .add("hidden");

    };

}


/* =========================================================
   MESSY AI
   ========================================================= */

var aiInput =
  $("aiInput");

var aiSend =
  $("aiSend");

var aiMessages =
  $("aiMessages");

var aiStatus =
  $("aiStatus");

var clearAi =
  $("clearAi");

var aiHistory = [];


function focusAI() {

  setTimeout(
    function() {

      if (aiInput) {

        aiInput.focus();

      }

    },
    100
  );

}


function aiBubble(
  role,
  text
) {

  if (!aiMessages)
    return;


  var row =
    document.createElement(
      "div"
    );


  row.className =
    "ai-row " +
    role;


  var bubble =
    document.createElement(
      "div"
    );


  bubble.className =
    "ai-bubble";


  bubble.innerHTML =
    esc(text)
      .replace(
        /\n/g,
        "<br>"
      );


  row.appendChild(
    bubble
  );


  aiMessages.appendChild(
    row
  );


  aiMessages.scrollTop =
    aiMessages.scrollHeight;


  return bubble;
}


/*
   IMPORTANT:

   We use the Supabase Edge Function.

   The OpenAI API key is NOT sent from the browser.

   The browser only sends:
   message + conversation history.

   The Edge Function handles OpenAI securely.
*/


async function sendAI() {

  if (!aiInput || !me)
    return;


  var text =
    aiInput.value
      .trim();


  if (!text)
    return;


  if (
    aiSend &&
    aiSend.disabled
  ) {
    return;
  }


  aiInput.value =
    "";


  aiBubble(
    "user",
    text
  );


  aiHistory.push({

    role:
      "user",

    content:
      text

  });


  if (aiSend) {
    aiSend.disabled =
      true;
  }


  if (aiStatus) {

    aiStatus.textContent =
      "Messy AI is thinking…";

  }


  try {

    /*
       Get the current Supabase session.
    */

    var sessionResult =
      await sb.auth.getSession();


    var session =
      sessionResult.data &&
      sessionResult.data.session;


    if (!session) {

      throw new Error(
        "You are not logged in."
      );

    }


    /*
       Secure Edge Function URL.

       Uses SUPABASE_URL from config.js.
    */

    var functionUrl =
      SUPABASE_URL +
      "/functions/v1/messy-ai";


    /*
       Send request directly to the
       Supabase Edge Function.

       NO OpenAI key here.
    */

    var response =
      await fetch(
        functionUrl,
        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json",

            "Authorization":
              "Bearer " +
              session.access_token,

            "apikey":
              SUPABASE_ANON_KEY

          },

          body:
            JSON.stringify({

              message:
                text,

              history:
                aiHistory.slice(
                  -12
                )

            })

        }
      );


    var data = null;


    try {

      data =
        await response.json();

    } catch (jsonError) {

      throw new Error(
        "The Edge Function returned an invalid response."
      );

    }


    if (!response.ok) {

      throw new Error(
        data &&
        data.error
          ? data.error
          : "Messy AI request failed."
      );

    }


    var answer =
      data &&
      data.reply
        ? data.reply
        : "";


    if (!answer) {

      throw new Error(
        "Messy AI returned an empty response."
      );

    }


    aiHistory.push({

      role:
        "assistant",

      content:
        answer

    });


    aiBubble(
      "assistant",
      answer
    );


    if (aiStatus) {
      aiStatus.textContent =
        "";
    }


  } catch (error) {

    console.log(
      "MESSY AI ERROR:",
      error
    );


    /*
       Remove the user's last message
       from history if the request failed.
       This prevents a failed request
       from polluting future history.
    */

    if (
      aiHistory.length &&
      aiHistory[
        aiHistory.length - 1
      ].role === "user"
    ) {

      aiHistory.pop();

    }


    var errorMessage =
      error &&
      error.message
        ? error.message
        : "Could not connect to Messy AI.";


    aiBubble(
      "assistant",
      "I couldn't connect to Messy AI.\n\n" +
      errorMessage
    );


    if (aiStatus) {

      aiStatus.textContent =
        "AI request failed";

    }

  }


  if (aiSend) {
    aiSend.disabled =
      false;
  }


  focusAI();

}


/* AI Send */

if (aiSend) {

  aiSend.addEventListener(
    "click",
    sendAI
  );

}


/* AI Enter */

if (aiInput) {

  aiInput.addEventListener(
    "keydown",
    function(event) {

      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {

        event.preventDefault();

        sendAI();

      }

    }
  );


  /*
     Make sure the AI box is usable.
  */

  aiInput.disabled =
    false;

  aiInput.readOnly =
    false;

}


/* AI Clear */

if (clearAi) {

  clearAi.addEventListener(
    "click",
    function() {

      aiHistory = [];


      if (aiMessages) {

        aiMessages.innerHTML =

          '<div class="ai-welcome">' +

            '<div class="ai-orb">' +
              '🤖' +
            '</div>' +

            '<strong>' +
              "Hey, I'm Messy AI." +
            '</strong>' +

            '<span>' +
              "Ask me anything, brainstorm, rewrite a message, or get a caption." +
            '</span>' +

          '</div>';

      }


      if (aiStatus) {
        aiStatus.textContent =
          "";
      }


      focusAI();

    }
  );

}


/* =========================================================
   PAGEHIDE
   ========================================================= */

window.addEventListener(
  "pagehide",
  function() {

    if (!me)
      return;


    sb
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
);


/* =========================================================
   SERVICE WORKER
   ========================================================= */

if (
  "serviceWorker" in navigator
) {

  window.addEventListener(
    "load",
    function() {

      navigator.serviceWorker
        .register("sw.js")
        .catch(
          function(error) {

            console.log(
              "Service worker unavailable:",
              error
            );

          }
        );

    }
  );

}


/* =========================================================
   START
   ========================================================= */

boot();
