/* =========================================================
   MESSY APP.JS

   PRIMARY TARGET:
   iPhone 6 / iOS 12.5

   Compatibility rules:
   - No optional chaining ?.
   - No nullish coalescing ??
   - No crypto.randomUUID()
   - No modern-only syntax
   - Voice recording is feature detected
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
   DOM HELPERS
   ========================================================= */

function $(id) {
  return document.getElementById(id);
}


var authView = $("authView");
var chatView = $("chatView");

var authForm = $("authForm");

var userList = $("userList");

var messages = $("messages");

var messageInput = $("messageInput");


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function initials(name) {

  var value = name || "?";

  return value
    .substring(0, 2)
    .toUpperCase();
}


function esc(value) {

  var s = String(
    value == null ? "" : value
  );

  return s.replace(
    /[&<>"']/g,
    function(c) {

      var map = {

        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"

      };

      return map[c];
    }
  );
}


function fmt(time) {

  if (!time) {
    return "";
  }

  return new Date(time)
    .toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    );
}


function setAuthMessage(text) {

  if ($("authMsg")) {

    $("authMsg").textContent =
      text || "";
  }
}


function setUploadStatus(text) {

  if ($("uploadStatus")) {

    $("uploadStatus").textContent =
      text || "";
  }
}


function scrollMessages() {

  if (!messages) {
    return;
  }

  setTimeout(
    function() {

      messages.scrollTop =
        messages.scrollHeight;

    },
    0
  );
}


function randomName(prefix) {

  return (
    prefix +
    "-" +
    Date.now() +
    "-" +
    Math.floor(
      Math.random() * 1000000
    )
  );
}


/* =========================================================
   AUTH TABS
   ========================================================= */

var tabs =
  document.querySelectorAll(".tab");


for (var i = 0; i < tabs.length; i++) {

  tabs[i].addEventListener(
    "click",
    function() {

      authMode =
        this.getAttribute(
          "data-auth"
        );


      var allTabs =
        document.querySelectorAll(
          ".tab"
        );


      for (
        var j = 0;
        j < allTabs.length;
        j++
      ) {

        allTabs[j].classList.toggle(
          "active",
          allTabs[j] === this
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

    }
  );
}


/* =========================================================
   AUTH
   ========================================================= */

authForm.addEventListener(
  "submit",
  async function(event) {

    event.preventDefault();

    setAuthMessage(
      "Working…"
    );


    var email =
      $("email").value.trim();

    var password =
      $("password").value;


    try {

      if (!email || !password) {

        setAuthMessage(
          "Please enter your email and password."
        );

        return;
      }


      /* LOGIN */

      if (authMode === "login") {

        var loginResult =
          await sb.auth.signInWithPassword({
            email: email,
            password: password
          });


        if (loginResult.error) {

          setAuthMessage(
            loginResult.error.message
          );

        }

        return;
      }


      /* SIGNUP */

      var username =
        $("username")
          .value
          .trim()
          .toLowerCase();


      if (
        !/^[a-z0-9_]{3,24}$/
          .test(username)
      ) {

        setAuthMessage(
          "Username: 3–24 letters, numbers or _"
        );

        return;
      }


      var signupResult =
        await sb.auth.signUp({

          email: email,

          password: password,

          options: {

            data: {
              username: username
            }

          }

        });


      if (signupResult.error) {

        setAuthMessage(
          signupResult.error.message
        );

        return;
      }


      if (
        signupResult.data &&
        signupResult.data.user
      ) {

        var profileResult =
          await sb
            .from("profiles")
            .upsert({

              id:
                signupResult.data.user.id,

              username:
                username,

              display_name:
                username

            });


        if (profileResult.error) {

          console.log(
            "Profile creation:",
            profileResult.error
          );

        }

      }


      setAuthMessage(
        "Account created. Check your email if confirmation is enabled."
      );


    } catch (error) {

      console.log(error);

      setAuthMessage(

        error && error.message
          ? error.message
          : "Something went wrong."

      );

    }

  }
);


/* =========================================================
   BOOT
   ========================================================= */

async function boot() {

  if (booted) {
    return;
  }

  booted = true;


  try {

    var sessionResult =
      await sb.auth.getSession();


    if (
      sessionResult.data &&
      sessionResult.data.session &&
      sessionResult.data.session.user
    ) {

      await enter(
        sessionResult.data.session.user
      );

    }


    sb.auth.onAuthStateChange(
      async function(
        event,
        session
      ) {

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


        if (
          event === "SIGNED_OUT"
        ) {

          me = null;

          selectedUser = null;


          if (channel) {

            try {

              await sb.removeChannel(
                channel
              );

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

  if (!user) {
    return;
  }


  me = user;


  authView.classList.add(
    "hidden"
  );

  chatView.classList.remove(
    "hidden"
  );


  try {

    var profileResult =
      await sb
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();


    var profile =
      profileResult.data;


    $("meLabel").textContent =
      "@" +
      (
        profile &&
        profile.username
          ? profile.username
          : user.email
      );


    await sb
      .from("profiles")
      .update({

        is_online: true,

        last_seen:
          new Date().toISOString()

      })
      .eq(
        "id",
        user.id
      );


    await loadUsers();


    setupPresence();


    if (presenceTimer) {

      clearInterval(
        presenceTimer
      );

    }


    presenceTimer =
      setInterval(
        updateMyPresence,
        60000
      );


  } catch (error) {

    console.log(
      "Enter error:",
      error
    );

  }
}


async function updateMyPresence() {

  if (!me) {
    return;
  }


  await sb
    .from("profiles")
    .update({

      is_online: true,

      last_seen:
        new Date().toISOString()

    })
    .eq(
      "id",
      me.id
    );
}


/* =========================================================
   LOAD USERS
   ========================================================= */

async function loadUsers(query) {

  if (!me) {
    return;
  }


  query = query || "";


  try {

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
        );


    if (query) {

      request =
        request.ilike(
          "username",
          "%" +
          query +
          "%"
        );

    }


    var result =
      await request;


    if (result.error) {

      console.log(
        result.error
      );


      userList.innerHTML =
        '<div class="empty-users">' +
        'Unable to load users.' +
        '</div>';


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


/* =========================================================
   CONVERSATION PREVIEWS
   ========================================================= */

async function loadConversationPreviews() {

  conversationCache = {};


  if (!me) {
    return;
  }


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


      if (
        !conversationCache[otherId]
      ) {

        conversationCache[otherId] = {

          message:
            message,

          unread:
            0

        };

      }


      if (
        message.receiver_id === me.id &&
        !message.seen_at
      ) {

        conversationCache[
          otherId
        ].unread += 1;

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
   RENDER USER LIST
   ========================================================= */

function renderUsers() {

  if (!userList) {
    return;
  }


  if (!usersCache.length) {

    userList.innerHTML =
      '<div class="empty-users">' +
      'No users found.' +
      '</div>';

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
      conversationCache[
        user.id
      ];


    var lastMessage =
      preview
        ? preview.message
        : null;


    var previewText =
      "";


    if (lastMessage) {

      if (
        lastMessage.message_type ===
        "image"
      ) {

        previewText =
          "Photo";

      } else if (
        lastMessage.message_type ===
        "audio"
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

      '<button type="button" ' +
      'class="user ' +
      (
        active
          ? "active"
          : ""
      ) +
      '" data-id="' +
      esc(user.id) +
      '">' +


        '<div class="avatar">' +
          esc(
            initials(
              user.username
            )
          ) +
        '</div>' +


        '<div class="user-info">' +

          '<strong>@' +
            esc(
              user.username
            ) +
          '</strong>' +


          '<span>' +

            '<i class="dot ' +
              (
                user.is_online
                  ? "online"
                  : ""
              ) +
            '"></i>' +

            esc(
              previewText
            ) +

          '</span>' +

        '</div>' +


        (
          unread > 0

            ?

            '<span style="' +
              'margin-left:auto;' +
              'min-width:19px;' +
              'height:19px;' +
              'padding:0 5px;' +
              'border-radius:10px;' +
              'display:inline-block;' +
              'background:#7654f6;' +
              'color:white;' +
              'font-size:9px;' +
              'font-weight:800;' +
              'text-align:center;' +
              'line-height:19px;' +
            '">' +

              (
                unread > 99
                  ? "99+"
                  : unread
              ) +

            '</span>'

            :

            ""

        ) +


      '</button>';

  }


  userList.innerHTML =
    html;
}


/* =========================================================
   USER CLICK
   ========================================================= */

userList.addEventListener(
  "click",
  async function(event) {

    var target =
      event.target;


    while (
      target &&
      target !== userList &&
      !target.classList.contains(
        "user"
      )
    ) {

      target =
        target.parentNode;

    }


    if (
      !target ||
      target === userList
    ) {

      return;
    }


    var id =
      target.getAttribute(
        "data-id"
      );


    if (!id) {
      return;
    }


    var user = null;


    for (
      var i = 0;
      i < usersCache.length;
      i++
    ) {

      if (
        usersCache[i].id === id
      ) {

        user =
          usersCache[i];

        break;

      }

    }


    if (user) {

      await selectUser(
        user
      );

    }

  }
);


/* =========================================================
   SEARCH
   ========================================================= */

$("userSearch").addEventListener(
  "input",
  function() {

    var value =
      this.value.trim();


    loadUsers(
      value
    );

  }
);


/* =========================================================
   OPEN CHAT
   ========================================================= */

async function selectUser(user) {

  if (!user || !me) {
    return;
  }


  selectedUser =
    user;


  $("chatName").textContent =
    "@" +
    user.username;


  $("chatAvatar").textContent =
    initials(
      user.username
    );


  updatePresenceText(
    user
  );


  messageInput.disabled =
    false;


  $("sendBtn").disabled =
    false;


  chatView
    .querySelector(".chat")
    .classList.add(
      "open"
    );


  chatView
    .querySelector(".sidebar")
    .classList.add(
      "hide-mobile"
    );


  renderUsers();


  await loadMessages();


  subscribeMessages();


  subscribeTyping();


  messageInput.focus();
}


function updatePresenceText(user) {

  if (!user) {
    return;
  }


  if (user.is_online) {

    $("presence").innerHTML =
      '<span style="color:#3edc8a;">●</span> online';

  } else if (
    user.last_seen
  ) {

    $("presence").textContent =
      "last seen " +
      fmt(
        user.last_seen
      );

  } else {

    $("presence").textContent =
      "offline";

  }
}


/* =========================================================
   LOAD MESSAGES
   ========================================================= */

async function loadMessages() {

  if (
    !me ||
    !selectedUser
  ) {

    return;
  }


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


    messages.innerHTML =
      '<div class="empty">' +
        '<strong>' +
          'Could not load messages.' +
        '</strong>' +
        '<span>' +
          'Please try again.' +
        '</span>' +
      '</div>';


    return;
  }


  messages.innerHTML =
    "";


  var list =
    result.data || [];


  if (!list.length) {

    messages.innerHTML =
      '<div class="empty">' +

        '<div class="empty-icon">' +
          '✦' +
        '</div>' +

        '<strong>' +
          'Start the conversation' +
        '</strong>' +

        '<span>' +
          'Send your first message.' +
        '</span>' +

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

function renderMessage(
  message
) {

  if (!messages) {
    return;
  }


  var mine =
    message.sender_id === me.id;


  var row =
    document.createElement(
      "div"
    );


  row.className =
    "bubble-row " +
    (
      mine
        ? "mine"
        : ""
    );


  row.setAttribute(
    "data-message-id",
    message.id
  );


  var body = "";


  if (
    message.message_type ===
    "image"
  ) {

    body =
      '<img src="' +
      esc(
        message.file_url
      ) +
      '" alt="Image">';

  } else if (
    message.message_type ===
    "audio"
  ) {

    body =
      '<audio class="voice" controls ' +
      'preload="metadata" src="' +
      esc(
        message.file_url
      ) +
      '"></audio>';

  } else {

    body =
      esc(
        message.content
      );

  }


  row.innerHTML =

    '<div class="bubble">' +

      body +

      '<div class="meta">' +

        esc(
          fmt(
            message.created_at
          )
        ) +

        (
          mine

            ?

            (
              message.seen_at
                ? " ✓✓"
                : " ✓"
            )

            :

            ""
        ) +

      '</div>' +


      '<div class="reactionbar">' +

        '<button type="button" ' +
        'class="reaction" ' +
        'data-react="❤️">' +
        '♥' +
        '</button>' +

        '<button type="button" ' +
        'class="reaction" ' +
        'data-react="😂">' +
        '☺' +
        '</button>' +

        '<button type="button" ' +
        'class="reaction" ' +
        'data-react="👍">' +
        '+' +
        '</button>' +

        (
          mine

            ?

            '<button type="button" ' +
            'class="reaction" ' +
            'data-delete="1">' +
            '×' +
            '</button>'

            :

            ""
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


  messages.appendChild(
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

  if (
    !me ||
    !selectedUser
  ) {

    return false;
  }


  type =
    type || "text";


  fileUrl =
    fileUrl || null;


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
          type,

        file_url:
          fileUrl

      });


  if (result.error) {

    alert(
      result.error.message
    );

    return false;
  }


  return true;
}


/* =========================================================
   SEND BUTTON
   ========================================================= */

$("sendBtn").addEventListener(
  "click",
  async function() {

    var value =
      messageInput.value.trim();


    if (
      !value ||
      !selectedUser
    ) {

      return;
    }


    var sent =
      await sendMessage(
        value,
        "text",
        null
      );


    if (sent) {

      messageInput.value =
        "";

      autoResize();

      stopTyping();

    }

  }
);


/* =========================================================
   TEXT INPUT
   ========================================================= */

messageInput.addEventListener(
  "keydown",
  function(event) {

    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {

      event.preventDefault();

      $("sendBtn").click();

    }

  }
);


messageInput.addEventListener(
  "input",
  function() {

    autoResize();


    if (
      !selectedUser ||
      !channel
    ) {

      return;
    }


    if (!typingActive) {

      typingActive =
        true;


      channel.send({

        type:
          "broadcast",

        event:
          "typing",

        payload: {

          user_id:
            me.id,

          typing:
            true

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


function autoResize() {

  messageInput.style.height =
    "auto";


  var height =
    messageInput.scrollHeight;


  if (height > 112) {
    height = 112;
  }


  messageInput.style.height =
    height + "px";
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


  typingActive =
    false;


  channel.send({

    type:
      "broadcast",

    event:
      "typing",

    payload: {

      user_id:
        me.id,

      typing:
        false

    }

  });
}


/* =========================================================
   REALTIME MESSAGES
   ========================================================= */

async function subscribeMessages() {

  if (
    !me ||
    !selectedUser
  ) {

    return;
  }


  if (channel) {

    try {

      await sb.removeChannel(
        channel
      );

    } catch (e) {}


    channel =
      null;
  }


  var room =
    "chat-" +
    [
      me.id,
      selectedUser.id
    ]
      .sort()
      .join("-");


  channel =
    sb.channel(
      room
    );


  channel.on(

    "postgres_changes",

    {

      event:
        "INSERT",

      schema:
        "public",

      table:
        "messages"

    },

    async function(payload) {

      var message =
        payload.new;


      if (!message) {
        return;
      }


      var relevant =

        (
          message.sender_id === me.id &&
          message.receiver_id === selectedUser.id
        )

        ||

        (
          message.sender_id === selectedUser.id &&
          message.receiver_id === me.id
        );


      if (!relevant) {
        return;
      }


      var existing =
        messages.querySelector(
          '[data-message-id="' +
          message.id +
          '"]'
        );


      if (!existing) {

        var empty =
          messages.querySelector(
            ".empty"
          );


        if (empty) {
          messages.innerHTML = "";
        }


        renderMessage(
          message
        );


        scrollMessages();

      }


      if (
        message.receiver_id ===
        me.id
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
          .value
          .trim()
      );

    }
  );


  channel.on(

    "postgres_changes",

    {

      event:
        "UPDATE",

      schema:
        "public",

      table:
        "messages"

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


/* =========================================================
   TYPING
   ========================================================= */

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
      event:
        "typing"
    },

    function(event) {

      var payload =
        event.payload;


      if (!payload) {
        return;
      }


      if (
        payload.user_id !==
        selectedUser.id
      ) {

        return;
      }


      $("typing").classList.toggle(
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

  if (!me) {
    return;
  }


  if (presenceChannel) {

    try {

      sb.removeChannel(
        presenceChannel
      );

    } catch (e) {}


    presenceChannel =
      null;
  }


  presenceChannel =
    sb.channel(

      "messy-presence",

      {

        config: {

          presence: {

            key:
              me.id

          }

        }

      }

    );


  presenceChannel.on(

    "presence",

    {

      event:
        "sync"

    },

    function() {

      loadUsers(
        $("userSearch")
          .value
          .trim()
      );

    }

  );


  presenceChannel.subscribe(

    async function(status) {

      if (
        status ===
        "SUBSCRIBED"
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
   LOGOUT
   ========================================================= */

$("logoutBtn").addEventListener(
  "click",
  async function() {

    if (me) {

      await sb
        .from("profiles")
        .update({

          is_online:
            false,

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


/* =========================================================
   MOBILE BACK
   ========================================================= */

$("backBtn").addEventListener(
  "click",
  function() {

    chatView
      .querySelector(".chat")
      .classList.remove(
        "open"
      );


    chatView
      .querySelector(".sidebar")
      .classList.remove(
        "hide-mobile"
      );


    selectedUser =
      null;


    messageInput.disabled =
      true;


    $("sendBtn").disabled =
      true;


    $("chatName").textContent =
      "Select a user";


    $("chatAvatar").textContent =
      "?";


    $("presence").textContent =
      "Choose someone to chat";


    $("typing").classList.add(
      "hidden"
    );


    messageInput.value =
      "";


    renderUsers();

  }
);


/* =========================================================
   IMAGE UPLOAD
   ========================================================= */

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
        randomName(
          "image"
        ) +
        "-" +
        safeName;


      var uploadResult =
        await sb
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


      if (uploadResult.error) {

        setUploadStatus(
          uploadResult.error.message
        );

        return;
      }


      var publicResult =
        sb
          .storage
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

      console.log(error);

      setUploadStatus(
        "Image upload failed."
      );

    } finally {

      event.target.value =
        "";

    }

  }
);


/* =========================================================
   VOICE RECORDING
   ========================================================= */

function voiceRecordingSupported() {

  return !!(
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia &&
    window.MediaRecorder
  );
}


if (
  !voiceRecordingSupported()
) {

  $("recordBtn").disabled =
    true;

  $("recordBtn").title =
    "Voice messages are unavailable on this older iPhone.";

}


$("recordBtn").addEventListener(
  "click",
  async function() {

    if (
      !voiceRecordingSupported()
    ) {

      alert(
        "Voice recording is not supported by Safari on iOS 12.5."
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
        .remove(
          "recording"
        );


      return;
    }


    try {

      var stream =
        await navigator
          .mediaDevices
          .getUserMedia({
            audio: true
          });


      audioChunks =
        [];


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
              "audio/mp4";


            var blob =
              new Blob(
                audioChunks,
                {
                  type: mime
                }
              );


            if (!blob.size) {
              return;
            }


            setUploadStatus(
              "Uploading voice message…"
            );


            var extension =
              mime.indexOf(
                "mp4"
              ) !== -1
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


            var uploadResult =
              await sb
                .storage
                .from("chat-media")
                .upload(
                  path,
                  blob,
                  {
                    contentType:
                      mime
                  }
                );


            if (
              uploadResult.error
            ) {

              setUploadStatus(
                uploadResult.error.message
              );

              return;
            }


            var publicResult =
              sb
                .storage
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

            console.log(error);

            setUploadStatus(
              "Voice upload failed."
            );

          }

        };


      mediaRecorder.start();


      $("recordBtn")
        .classList
        .add(
          "recording"
        );


    } catch (error) {

      console.log(error);

      alert(
        "Microphone permission was denied or is unavailable."
      );

    }

  }
);


/* =========================================================
   DELETE MESSAGE
   ========================================================= */

async function deleteMessage(
  id
) {

  if (!id || !me) {
    return;
  }


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
      .eq(
        "id",
        id
      )
      .eq(
        "sender_id",
        me.id
      );


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

  if (
    !messageId ||
    !me
  ) {

    return;
  }


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
   PAGE LIFECYCLE
   ========================================================= */

window.addEventListener(
  "pagehide",
  function() {

    if (!me) {
      return;
    }


    sb
      .from("profiles")
      .update({

        is_online:
          false,

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

      navigator
        .serviceWorker
        .register(
          "sw.js"
        )
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
/* =========================================================
   MAIN APP TAB NAVIGATION
   Messages / Memes / Discover / Messy AI
   iOS 12.5 compatible
   ========================================================= */

(function () {

  var messagesBtn = document.getElementById("messagesTabBtn");
  var memesBtn = document.getElementById("memesTabBtn");
  var discoverBtn = document.getElementById("discoverTabBtn");
  var aiBtn = document.getElementById("aiTabBtn");

  var messagesPage = document.querySelector(".chat");
  var memesPage = document.getElementById("memesPage");
  var discoverPage = document.getElementById("discoverPage");
  var aiPage = document.getElementById("aiPage");

  var searchWrap = document.querySelector(".sidebar .search-wrap");
  var userList = document.getElementById("userList");
  var sideTitle = document.getElementById("sidePageTitle");

  function hideAllPages() {

    if (messagesPage) {
      messagesPage.classList.add("hidden");
    }

    if (memesPage) {
      memesPage.classList.add("hidden");
    }

    if (discoverPage) {
      discoverPage.classList.add("hidden");
    }

    if (aiPage) {
      aiPage.classList.add("hidden");
    }

  }


  function removeActive() {

    var buttons = document.querySelectorAll(
      ".main-nav-item"
    );

    for (var i = 0; i < buttons.length; i++) {

      buttons[i].classList.remove("active");

    }

  }


  function showTab(name) {

    hideAllPages();
    removeActive();


    if (name === "messages") {

      if (messagesPage) {
        messagesPage.classList.remove("hidden");
      }

      if (messagesBtn) {
        messagesBtn.classList.add("active");
      }

      if (searchWrap) {
        searchWrap.classList.remove("hidden");
      }

      if (userList) {
        userList.classList.remove("hidden");
      }

      if (sideTitle) {
        sideTitle.textContent = "Messages";
      }

    }


    else if (name === "memes") {

      if (memesPage) {
        memesPage.classList.remove("hidden");
      }

      if (memesBtn) {
        memesBtn.classList.add("active");
      }

      if (searchWrap) {
        searchWrap.classList.add("hidden");
      }

      if (userList) {
        userList.classList.add("hidden");
      }

      if (sideTitle) {
        sideTitle.textContent = "Memes";
      }

    }


    else if (name === "discover") {

      if (discoverPage) {
        discoverPage.classList.remove("hidden");
      }

      if (discoverBtn) {
        discoverBtn.classList.add("active");
      }

      if (searchWrap) {
        searchWrap.classList.add("hidden");
      }

      if (userList) {
        userList.classList.add("hidden");
      }

      if (sideTitle) {
        sideTitle.textContent = "Discover";
      }

    }


    else if (name === "ai") {

      if (aiPage) {
        aiPage.classList.remove("hidden");
      }

      if (aiBtn) {
        aiBtn.classList.add("active");
      }

      if (searchWrap) {
        searchWrap.classList.add("hidden");
      }

      if (userList) {
        userList.classList.add("hidden");
      }

      if (sideTitle) {
        sideTitle.textContent = "Messy AI";
      }

    }

  }


  if (messagesBtn) {

    messagesBtn.addEventListener(
      "click",
      function () {

        showTab("messages");

      }
    );

  }


  if (memesBtn) {

    memesBtn.addEventListener(
      "click",
      function () {

        showTab("memes");

      }
    );

  }


  if (discoverBtn) {

    discoverBtn.addEventListener(
      "click",
      function () {

        showTab("discover");

      }
    );

  }


  if (aiBtn) {

    aiBtn.addEventListener(
      "click",
      function () {

        showTab("ai");

      }
    );

  }


  /* Start on Messages */

  showTab("messages");

})();
