/* =========================================================
   MESSY APP.JS
   Built for iPhone 6 / iOS 12.5 first.

   Important compatibility choices:
   - No optional chaining (?.)
   - No nullish coalescing (??)
   - No crypto.randomUUID()
   - No modern viewport-unit dependency
   - Voice recording is feature-detected and disabled on
     iOS 12 because MediaRecorder is not reliably available.
   ========================================================= */

var sb = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

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
  return value.substring(0, 2).toUpperCase();
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

function fmt(time) {
  if (!time) return "";

  return new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function fmtListTime(time) {
  if (!time) return "";

  var date = new Date(time);
  var now = new Date();

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
  if (!messages) return;

  setTimeout(function() {
    messages.scrollTop = messages.scrollHeight;
  }, 0);
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


/* =========================================================
   AUTH TABS
   ========================================================= */

var tabs = document.querySelectorAll(".tab");

for (var i = 0; i < tabs.length; i++) {

  tabs[i].addEventListener("click", function(event) {

    /*
     * Important for iPhone/Safari:
     * authentication tabs must never submit the form.
     */
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    authMode =
      this.getAttribute("data-auth") || "login";

    var allTabs =
      document.querySelectorAll(".tab");

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

    return false;
  });

}


/* =========================================================
   AUTH FORM
   iPHONE / SAFARI SAFE
   ========================================================= */

/*
 * The old version depended entirely on the form's
 * "submit" event.
 *
 * On older Safari/iPhone combinations this can cause
 * the page/form state to reset and authMode becomes
 * "login" again.
 *
 * We now handle the button click directly AND block
 * the normal form submission.
 */


/* ---------------------------------------------------------
   CREATE ACCOUNT / LOGIN BUTTON
   --------------------------------------------------------- */

if ($("authButton")) {

  $("authButton").addEventListener(
    "click",
    async function(event) {

      event.preventDefault();
      event.stopPropagation();

      await handleAuth();

      return false;
    },
    false
  );

}


/* ---------------------------------------------------------
   BLOCK NORMAL FORM SUBMISSION
   --------------------------------------------------------- */

if (authForm) {

  authForm.addEventListener(
    "submit",
    function(event) {

      event.preventDefault();
      event.stopPropagation();

      /*
       * Do NOT call handleAuth() here.
       *
       * The button click handler above is responsible
       * for authentication.
       *
       * This prevents Safari from executing the native
       * form submission after our click.
       */

      return false;
    },
    false
  );

}


/* =========================================================
   AUTH FUNCTION
   ========================================================= */

async function handleAuth() {

  var emailElement =
    $("email");

  var passwordElement =
    $("password");

  var usernameElement =
    $("username");


  if (
    !emailElement ||
    !passwordElement
  ) {

    setAuthMessage(
      "Login form error. Please refresh Messy."
    );

    return;
  }


  var email =
    emailElement.value.trim();

  var password =
    passwordElement.value;


  /* =======================================================
     BASIC VALIDATION
     ======================================================= */

  if (!email) {

    setAuthMessage(
      "Please enter your email."
    );

    return;
  }


  if (!password) {

    setAuthMessage(
      "Please enter your password."
    );

    return;
  }


  /* =======================================================
     LOGIN
     ======================================================= */

  if (authMode === "login") {

    setAuthMessage(
      "Logging in..."
    );

    try {

      var loginResult =
        await sb.auth.signInWithPassword({

          email: email,

          password: password

        });


      if (loginResult.error) {

        console.log(
          "Login error:",
          loginResult.error
        );

        setAuthMessage(
          loginResult.error.message
        );

        return;
      }


      /*
       * Supabase's auth state listener will call
       * enter() after successful login.
       */

      setAuthMessage(
        "Logged in!"
      );

    } catch (error) {

      console.log(
        "Login exception:",
        error
      );

      setAuthMessage(
        error && error.message
          ? error.message
          : "Unable to log in."
      );
    }

    return;
  }


  /* =======================================================
     SIGNUP
     ======================================================= */

  var username = "";


  if (usernameElement) {

    username =
      usernameElement.value
        .trim()
        .toLowerCase();

  }


  if (
    !/^[a-z0-9_]{3,24}$/.test(
      username
    )
  ) {

    setAuthMessage(
      "Username: 3–24 letters, numbers or _"
    );

    return;
  }


  if (password.length < 6) {

    setAuthMessage(
      "Password must be at least 6 characters."
    );

    return;
  }


  setAuthMessage(
    "Creating your Messy account..."
  );


  try {

    /* =====================================================
       SUPABASE SIGNUP
       ===================================================== */

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


    /* =====================================================
       SIGNUP ERROR
       ===================================================== */

    if (signupResult.error) {

      console.log(
        "Signup error:",
        signupResult.error
      );

      setAuthMessage(
        signupResult.error.message
      );

      return;
    }


    /* =====================================================
       USER CREATED
       ===================================================== */

    if (
      signupResult.data &&
      signupResult.data.user
    ) {

      var createdUser =
        signupResult.data.user;


      /* ===================================================
         PROFILE
         =================================================== */

      try {

        var profileResult =
          await sb
            .from("profiles")
            .upsert({

              id:
                createdUser.id,

              username:
                username,

              display_name:
                username

            });


        if (profileResult.error) {

          /*
           * Profile errors should not make the signup
           * appear to fail.
           */

          console.log(
            "Profile creation:",
            profileResult.error
          );

        }

      } catch (profileError) {

        console.log(
          "Profile creation exception:",
          profileError
        );

      }


      /* ===================================================
         SESSION EXISTS
         =================================================== */

      if (
        signupResult.data.session
      ) {

        setAuthMessage(
          "Account created!"
        );


        /*
         * Give Supabase a moment to finish updating
         * its auth state before entering the app.
         */

        setTimeout(
          function() {

            enter(
              createdUser
            );

          },
          100
        );


        return;
      }


      /* ===================================================
         EMAIL CONFIRMATION
         =================================================== */

      setAuthMessage(
        "Account created. Check your email if confirmation is enabled."
      );

      return;
    }


    /* =====================================================
       FALLBACK
       ===================================================== */

    setAuthMessage(
      "Account created. Check your email."
    );


  } catch (error) {

    console.log(
      "Authentication error:",
      error
    );

    setAuthMessage(
      error && error.message
        ? error.message
        : "Something went wrong."
    );
  }
}


/* =========================================================
   BOOT
   ========================================================= */

async function boot() {

  if (booted) return;

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

  if (!user) return;

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

  if (!me) return;


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

  if (!me) return;

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
          "%" + query + "%"
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
   RENDER USERS
   ========================================================= */

function renderUsers() {

  if (!userList) return;


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
          lastMessage.content ||
          "";

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
      selectedUser.id ===
        user.id;


    html +=

      '<button type="button" class="user ' +
      (active ? "active" : "") +
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

            ? '<span style="' +
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

              "</span>"

            : ""
        ) +

      '</button>';

  }


  userList.innerHTML =
    html;
}


/* =========================================================
   USER CLICK — EVENT DELEGATION
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


    if (!id) return;


    var user = null;


    for (
      var i = 0;
      i < usersCache.length;
      i++
    ) {

      if (
        usersCache[i].id ===
        id
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

  if (!user || !me) return;

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
    .querySelector(
      ".chat"
    )
    .classList.add(
      "open"
    );


  chatView
    .querySelector(
      ".sidebar"
    )
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

  if (!user) return;


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
        '<strong>Could not load messages.</strong>' +
        '<span>Please try again.</span>' +
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

  if (!messages)
    return;


  var mine =
    message.sender_id ===
    me.id;


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


  var body =
    "";


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
      '<audio class="voice" controls preload="metadata" src="' +
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

  if (!me || !selectedUser) {
    return false;
  }

  type = type || "text";
  fileUrl = fileUrl || null;

  var result =
    await sb
      .from("messages")
      .insert({
        sender_id: me.id,
        receiver_id: selectedUser.id,
        content: content || "",
        message_type: type,
        file_url: fileUrl
      });

  if (result.error) {

    alert(result.error.message);

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

    if (!value || !selectedUser) return;

    var sent =
      await sendMessage(
        value,
        "text",
        null
      );

    if (sent) {

      messageInput.value = "";

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
   REALTIME CHAT
   ========================================================= */

async function subscribeMessages() {

  if (!me || !selectedUser) return;

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

      if (!message) return;

      var relevant =
        (
          message.sender_id === me.id &&
          message.receiver_id === selectedUser.id
        ) ||
        (
          message.sender_id === selectedUser.id &&
          message.receiver_id === me.id
        );

      if (!relevant) return;

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
        $("userSearch").value.trim()
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
      event: "typing"
    },
    function(event) {

      var payload =
        event.payload;

      if (!payload) return;

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

  if (!me) return;

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
        $("userSearch").value.trim()
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
   LOGOUT
   ========================================================= */

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


/* =========================================================
   MOBILE BACK
   ========================================================= */

$("backBtn").addEventListener(
  "click",
  function() {

    chatView
      .querySelector(".chat")
      .classList.remove("open");

    chatView
      .querySelector(".sidebar")
      .classList.remove("hide-mobile");

    selectedUser = null;

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

    messageInput.value = "";

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

      /*
       * iOS 12 does not have crypto.randomUUID().
       * Use a timestamp/random suffix instead.
       */

      var path =
        me.id +
        "/" +
        randomName("image") +
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
          .getPublicUrl(path);

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

      event.target.value = "";
    }
  }
);


/* =========================================================
   VOICE
   ========================================================= */

/*
 * MediaRecorder is NOT reliably available on iOS 12.
 *
 * We therefore keep the button in the UI but disable it
 * safely on unsupported devices instead of crashing app.js.
 */

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
        .remove("recording");

      return;
    }

    try {

      var stream =
        await navigator
          .mediaDevices
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
              "audio/mp4";

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
              randomName("voice") +
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
        .add("recording");

    } catch (error) {

      console.log(error);

      alert(
        "Microphone permission was denied or is unavailable."
      );
    }
  }
);


/* =========================================================
   DELETE
   ========================================================= */

async function deleteMessage(id) {

  if (!id || !me) return;

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

    if (!me) return;

    /*
     * Best-effort only.
     * Safari may stop JS immediately during pagehide.
     */

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


/* =========================================================
   MESSY SOCIAL + AI EXTENSIONS
   ========================================================= */

(function(){

  var memesPage =
    document.getElementById(
      "memesPage"
    );

  var discoverPage =
    document.getElementById(
      "discoverPage"
    );

  var aiPage =
    document.getElementById(
      "aiPage"
    );

  var messagesTabBtn =
    document.getElementById(
      "messagesTabBtn"
    );

  var memesTabBtn =
    document.getElementById(
      "memesTabBtn"
    );

  var discoverTabBtn =
    document.getElementById(
      "discoverTabBtn"
    );

  var aiTabBtn =
    document.getElementById(
      "aiTabBtn"
    );

  var chatMain =
    document.querySelector(
      "main.chat"
    );

  var sideTitle =
    document.getElementById(
      "sidePageTitle"
    );

  var searchWrap =
    document.querySelector(
      ".search-wrap"
    );


  function hidePages(){

    if(memesPage)
      memesPage.classList.add(
        "hidden"
      );

    if(discoverPage)
      discoverPage.classList.add(
        "hidden"
      );

    if(aiPage)
      aiPage.classList.add(
        "hidden"
      );

    if(chatMain)
      chatMain.classList.add(
        "hidden"
      );

    if(searchWrap)
      searchWrap.style.display =
        "block";
  }


  function navActive(btn){

    var all =
      document.querySelectorAll(
        ".main-nav-item"
      );

    for(
      var i = 0;
      i < all.length;
      i++
    ){

      all[i].classList.remove(
        "active"
      );

    }

    if(btn)
      btn.classList.add(
        "active"
      );
  }


  function showMessages(){

    hidePages();

    if(chatMain)
      chatMain.classList.remove(
        "hidden"
      );

    navActive(
      messagesTabBtn
    );

    if(sideTitle)
      sideTitle.textContent =
        "Messages";

    if(searchWrap)
      searchWrap.style.display =
        "block";
  }


  if(messagesTabBtn)
    messagesTabBtn.addEventListener(
      "click",
      showMessages
    );


  if(memesTabBtn)
    memesTabBtn.addEventListener(
      "click",
      function(){

        hidePages();

        if(memesPage)
          memesPage.classList.remove(
            "hidden"
          );

        navActive(
          memesTabBtn
        );

        if(sideTitle)
          sideTitle.textContent =
            "Memes";

        if(searchWrap)
          searchWrap.style.display =
            "none";

        loadMemes();

      }
    );


  if(discoverTabBtn)
    discoverTabBtn.addEventListener(
      "click",
      function(){

        hidePages();

        if(discoverPage)
          discoverPage.classList.remove(
            "hidden"
          );

        navActive(
          discoverTabBtn
        );

        if(sideTitle)
          sideTitle.textContent =
            "Discover";

        if(searchWrap)
          searchWrap.style.display =
            "none";

        loadDiscover();

      }
    );


  if(aiTabBtn)
    aiTabBtn.addEventListener(
      "click",
      function(){

        hidePages();

        if(aiPage)
          aiPage.classList.remove(
            "hidden"
          );

        navActive(
          aiTabBtn
        );

        if(sideTitle)
          sideTitle.textContent =
            "Messy AI";

        if(searchWrap)
          searchWrap.style.display =
            "none";

        focusAI();

      }
    );


  /* ---------------- MEMES ---------------- */

  var memeData = [];

  var memeLoaded =
    false;

  var memeLoading =
    false;

  var memeCategory =
    "hot";


  var fallback = [

    {
      id:"1",
      name:"Drake Hotline Bling",
      url:
        "https://i.imgflip.com/30b1gx.jpg"
    },

    {
      id:"2",
      name:"Distracted Boyfriend",
      url:
        "https://i.imgflip.com/1ur9b0.jpg"
    },

    {
      id:"3",
      name:"Two Buttons",
      url:
        "https://i.imgflip.com/1g8my4.jpg"
    },

    {
      id:"4",
      name:"Change My Mind",
      url:
        "https://i.imgflip.com/24y43o.jpg"
    },

    {
      id:"5",
      name:"One Does Not Simply",
      url:
        "https://i.imgflip.com/1bij.jpg"
    },

    {
      id:"6",
      name:"Always Has Been",
      url:
        "https://i.imgflip.com/46e43q.jpg"
    }

  ];


  function renderMemes(){

    var grid =
      document.getElementById(
        "memeGrid"
      );

    if(!grid)
      return;


    var q =
      (
        document.getElementById(
          "memeSearch"
        ) || {}
      ).value || "";


    q =
      q.toLowerCase();


    var out = [];


    for(
      var i = 0;
      i < memeData.length;
      i++
    ){

      var m =
        memeData[i];

      var n =
        (
          m.name || ""
        ).toLowerCase();


      if(
        q &&
        n.indexOf(q) < 0
      )
        continue;


      out.push(m);

    }


    if(!out.length){

      grid.innerHTML =
        '<div class="meme-loading">' +
        'No memes found 😭' +
        '</div>';

      return;
    }


    var html = "";


    for(
      var j = 0;
      j < out.length;
      j++
    ){

      var m2 =
        out[j];


      html +=
        '<article class="meme-card" data-meme="' +
        j +
        '">' +

          '<div class="meme-image-wrap">' +

            '<img class="meme-image" src="' +
            esc(m2.url) +
            '" alt="' +
            esc(m2.name) +
            '">' +

            '<div class="meme-actions">' +

              '<button class="meme-action" type="button">' +
                '♡' +
              '</button>' +

            '</div>' +

          '</div>' +

          '<div class="meme-info">' +

            '<span class="meme-title">' +
              esc(m2.name) +
            '</span>' +

            '<div class="meme-meta">' +
              'Tap to open' +
            '</div>' +

          '</div>' +

        '</article>';

    }


    grid.innerHTML =
      html;
  }


  function loadMemes(){

    if(
      memeLoaded ||
      memeLoading
    )
      return;


    memeLoading =
      true;


    var grid =
      document.getElementById(
        "memeGrid"
      );


    if(grid)
      grid.innerHTML =
        '<div class="meme-loading">' +
        'Finding memes...' +
        '</div>';


    var xhr =
      new XMLHttpRequest();


    xhr.open(
      "GET",
      "https://api.imgflip.com/get_memes",
      true
    );


    xhr.timeout =
      10000;


    xhr.onreadystatechange =
      function(){

        if(
          xhr.readyState !== 4
        )
          return;


        memeLoading =
          false;


        if(
          xhr.status >= 200 &&
          xhr.status < 300
        ){

          try{

            var d =
              JSON.parse(
                xhr.responseText
              );


            if(
              d.success &&
              d.data &&
              d.data.memes
            ){

              memeData =
                d.data.memes;

              memeLoaded =
                true;

              renderMemes();

              return;

            }

          }catch(e){}

        }


        memeData =
          fallback;

        memeLoaded =
          true;

        renderMemes();

      };


    xhr.onerror =
      function(){

        memeLoading =
          false;

        memeData =
          fallback;

        memeLoaded =
          true;

        renderMemes();

      };


    xhr.ontimeout =
      function(){

        memeLoading =
          false;

        memeData =
          fallback;

        memeLoaded =
          true;

        renderMemes();

      };


    xhr.send();

  }


  var cats =
    document.querySelectorAll(
      ".chip"
    );


  for(
    var ci = 0;
    ci < cats.length;
    ci++
  ){

    cats[ci].addEventListener(
      "click",
      function(){

        for(
          var k = 0;
          k < cats.length;
          k++
        ){

          cats[k].classList.remove(
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


  var ms =
    document.getElementById(
      "memeSearch"
    );


  if(ms)
    ms.addEventListener(
      "input",
      renderMemes
    );


  var rf =
    document.getElementById(
      "refreshMemes"
    );


  if(rf)
    rf.addEventListener(
      "click",
      function(){

        memeLoaded =
          false;

        loadMemes();

      }
    );


  var mg =
    document.getElementById(
      "memeGrid"
    );


  if(mg)
    mg.addEventListener(
      "click",
      function(e){

        var card =
          e.target;


        while(
          card &&
          card !== mg &&
          !card.classList.contains(
            "meme-card"
          )
        ){

          card =
            card.parentNode;

        }


        if(
          !card ||
          card === mg
        )
          return;


        var idx =
          parseInt(
            card.getAttribute(
              "data-meme"
            ),
            10
          );


        var visible =
          memeData;


        var meme =
          visible[idx];


        if(!meme)
          return;


        if(
          e.target.classList.contains(
            "meme-action"
          )
        ){

          e.stopPropagation();

          e.target.textContent =
            e.target.textContent ===
              "♡"
              ? "♥"
              : "♡";

          return;

        }


        var url =
          meme.url;


        var modal =
          document.createElement(
            "div"
          );


        modal.className =
          "meme-modal open";


        modal.innerHTML =
          '<div class="meme-modal-content">' +

            '<button class="meme-modal-close" type="button">' +
              '×' +
            '</button>' +

            '<img class="meme-modal-image" src="' +
              esc(url) +
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
          function(){

            modal.parentNode.removeChild(
              modal
            );

          };


        modal.querySelector(
          ".meme-send-chat"
        ).onclick =
          async function(){

            if(!selectedUser){

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
                url,
                "text",
                null
              );


            if(ok){

              modal.parentNode.removeChild(
                modal
              );

            }else{

              this.disabled =
                false;

              this.textContent =
                "Try again";

            }

          };

      }
    );


  /* ---------------- DISCOVER / FOLLOW ---------------- */

  var followingMap = {};

  var followerCount =
    0;

  var followingCount =
    0;


  var suggestionList =
    document.getElementById(
      "suggestionList"
    );


  var networkList =
    document.getElementById(
      "networkList"
    );


  var networkPanel =
    document.getElementById(
      "networkPanel"
    );


  var networkTitle =
    document.getElementById(
      "networkPanelTitle"
    );


  function personName(p){

    return (
      p.display_name ||
      p.username ||
      "User"
    );

  }


  async function loadDiscover(){

    if(!me)
      return;


    try{

      await loadFollowState();

      await renderNetworkCard();

      await loadSuggestions();

    }catch(e){

      console.log(
        "Discover error",
        e
      );

    }

  }


  async function loadFollowState(){

    followingMap = {};


    var r =
      await sb
        .from("follows")
        .select(
          "following_id"
        )
        .eq(
          "follower_id",
          me.id
        );


    if(!r.error){

      for(
        var i = 0;
        i < (r.data || []).length;
        i++
      ){

        followingMap[
          r.data[i].following_id
        ] = true;

      }

    }


    var a =
      await sb
        .from("follows")
        .select(
          "id",
          {
            count:
              "exact",
            head:
              true
          }
        )
        .eq(
          "follower_id",
          me.id
        );


    followingCount =
      a.count || 0;


    var b =
      await sb
        .from("follows")
        .select(
          "id",
          {
            count:
              "exact",
            head:
              true
          }
        )
        .eq(
          "following_id",
          me.id
        );


    followerCount =
      b.count || 0;

  }


  async function renderNetworkCard(){

    var el =
      document.getElementById(
        "myNetwork"
      );


    if(!el)
      return;


    var p =
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


    var prof =
      p.data || {};


    el.innerHTML =

      '<div class="network-name">' +
        esc(
          personName(prof)
        ) +
      '</div>' +

      '<div class="network-handle">@' +
        esc(
          prof.username || ""
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


    document.getElementById(
      "showFollowers"
    ).onclick =
      function(){

        openNetwork(
          "followers"
        );

      };


    document.getElementById(
      "showFollowing"
    ).onclick =
      function(){

        openNetwork(
          "following"
        );

      };

  }
   ```js
  async function loadSuggestions(){

    if(!suggestionList)
      return;

    var q =
      (
        document.getElementById(
          "discoverSearch"
        ) || {}
      ).value || "";

    var req =
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

    if(q)
      req =
        req.ilike(
          "username",
          "%" + q + "%"
        );

    var r =
      await req;

    if(r.error){

      suggestionList.innerHTML =
        '<div class="meme-loading">' +
        'Could not load people.' +
        '</div>';

      return;
    }

    var people =
      r.data || [];

    var html = "";

    for(
      var i = 0;
      i < people.length;
      i++
    ){

      var p =
        people[i];

      html +=
        personCard(p);

    }

    suggestionList.innerHTML =
      html ||
      '<div class="meme-loading">' +
      'No people found.' +
      '</div>';

    bindPersonButtons();
  }


  function personCard(p){

    var isFollowing =
      !!followingMap[p.id];

    return (
      '<div class="person-card" data-person="' +
      esc(p.id) +
      '">' +

        '<div class="person-avatar">' +
          esc(
            initials(
              personName(p)
            )
          ) +
        '</div>' +

        '<div class="person-info">' +

          '<strong>' +
            esc(
              personName(p)
            ) +
          '</strong>' +

          '<span>@' +
            esc(
              p.username || ""
            ) +

            (
              p.is_online
                ? " · Online"
                : ""
            ) +

          '</span>' +

        '</div>' +

        '<button class="follow-btn ' +
          (
            isFollowing
              ? "following"
              : ""
          ) +
          '" type="button" data-follow="' +
          esc(p.id) +
          '">' +

          (
            isFollowing
              ? "Following"
              : "Follow"
          ) +

        '</button>' +

      '</div>'
    );
  }


  function bindPersonButtons(){

    var btns =
      document.querySelectorAll(
        "[data-follow]"
      );

    for(
      var i = 0;
      i < btns.length;
      i++
    ){

      btns[i].onclick =
        toggleFollow;

    }


    var cards =
      document.querySelectorAll(
        ".person-card"
      );

    for(
      var j = 0;
      j < cards.length;
      j++
    ){

      cards[j].onclick =
        function(e){

          if(
            e.target &&
            e.target.getAttribute(
              "data-follow"
            )
          ){

            return;
          }

          var id =
            this.getAttribute(
              "data-person"
            );

          var found =
            null;

          for(
            var z = 0;
            z < usersCache.length;
            z++
          ){

            if(
              usersCache[z].id ===
              id
            ){

              found =
                usersCache[z];

              break;
            }

          }

          if(found)
            selectUser(
              found
            );

        };

    }

  }


  async function toggleFollow(e){

    e.stopPropagation();

    var btn =
      e.currentTarget;

    var id =
      btn.getAttribute(
        "data-follow"
      );

    if(
      !id ||
      id === me.id
    ){

      return;
    }

    btn.disabled =
      true;

    var isFollowing =
      !!followingMap[id];

    var r;


    if(isFollowing){

      r =
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

    }else{

      r =
        await sb
          .from("follows")
          .insert({
            follower_id:
              me.id,

            following_id:
              id
          });

    }


    if(r.error){

      console.log(
        "Follow error",
        r.error
      );

      btn.disabled =
        false;

      return;
    }


    await loadDiscover();
  }


  async function openNetwork(
    type
  ){

    if(
      !networkPanel ||
      !networkList
    ){

      return;
    }

    networkPanel.classList.remove(
      "hidden"
    );

    networkTitle.textContent =
      type === "followers"
        ? "Followers"
        : "Following";

    networkList.innerHTML =
      '<div class="meme-loading">' +
      'Loading…' +
      '</div>';


    var r;


    if(
      type === "followers"
    ){

      r =
        await sb
          .from("follows")
          .select(
            "follower_id,profiles:follower_id(id,username,display_name,is_online,last_seen)"
          )
          .eq(
            "following_id",
            me.id
          );

    }else{

      r =
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


    if(r.error){

      networkList.innerHTML =
        '<div class="meme-loading">' +
        'Could not load this list.' +
        '</div>';

      return;
    }


    var rows =
      r.data || [];

    var html = "";


    for(
      var i = 0;
      i < rows.length;
      i++
    ){

      var p =
        rows[i].profiles;

      if(p)
        html +=
          personCard(p);

    }


    networkList.innerHTML =
      html ||
      '<div class="meme-loading">' +
      'Nobody here yet.' +
      '</div>';

    bindPersonButtons();
  }


  /* =======================================================
     DISCOVER SEARCH
     ======================================================= */

  var ds =
    document.getElementById(
      "discoverSearch"
    );

  if(ds){

    ds.addEventListener(
      "input",
      function(){

        loadDiscover();

      }
    );

  }


  /* =======================================================
     CLOSE NETWORK
     ======================================================= */

  var cn =
    document.getElementById(
      "closeNetwork"
    );

  if(cn){

    cn.onclick =
      function(){

        networkPanel.classList.add(
          "hidden"
        );

      };

  }


  /* =======================================================
     MESSY AI
     ======================================================= */

  var aiInput =
    document.getElementById(
      "aiInput"
    );

  var aiSend =
    document.getElementById(
      "aiSend"
    );

  var aiMessages =
    document.getElementById(
      "aiMessages"
    );

  var aiStatus =
    document.getElementById(
      "aiStatus"
    );

  var clearAi =
    document.getElementById(
      "clearAi"
    );

  var aiHistory = [];


  function focusAI(){

    setTimeout(
      function(){

        if(aiInput)
          aiInput.focus();

      },
      80
    );

  }


  function aiBubble(
    role,
    text
  ){

    var row =
      document.createElement(
        "div"
      );

    row.className =
      "ai-row " +
      role;


    var b =
      document.createElement(
        "div"
      );

    b.className =
      "ai-bubble";


    b.innerHTML =
      esc(
        text
      ).replace(
        /\n/g,
        "<br>"
      );


    row.appendChild(
      b
    );


    aiMessages.appendChild(
      row
    );


    aiMessages.scrollTop =
      aiMessages.scrollHeight;


    return b;
  }


  function sendAI(){

    if(
      !aiInput ||
      !me
    ){

      return;
    }


    var text =
      aiInput.value
        .replace(
          /^\s+|\s+$/g,
          ""
        );


    if(
      !text ||
      aiSend.disabled
    ){

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


    aiSend.disabled =
      true;


    aiStatus.textContent =
      "Messy AI is thinking…";


    var body = {

      message:
        text,

      history:
        aiHistory.slice(
          -12
        )

    };


    sb.functions
      .invoke(
        "messy-ai",
        {
          body:
            body
        }
      )

      .then(
        function(result){

          if(
            result.error
          ){

            throw result.error;

          }


          var answer =
            result.data &&
            result.data.reply
              ? result.data.reply
              : "I couldn't generate a reply.";


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


          aiStatus.textContent =
            "";

        }
      )

      .catch(
        function(err){

          console.log(
            "AI error",
            err
          );


          aiBubble(
            "assistant",
            "I couldn't reach Messy AI right now. Check that the secure Supabase Edge Function is deployed."
          );


          aiStatus.textContent =
            "AI unavailable";

        }
      )

      .then(
        function(){

          aiSend.disabled =
            false;

        }
      );

  }


  if(aiSend){

    aiSend.addEventListener(
      "click",
      sendAI
    );

  }


  if(aiInput){

    aiInput.addEventListener(
      "keydown",
      function(e){

        if(
          e.key === "Enter" &&
          !e.shiftKey
        ){

          e.preventDefault();

          sendAI();

        }

      }
    );

  }


  if(clearAi){

    clearAi.addEventListener(
      "click",
      function(){

        aiHistory = [];

        aiMessages.innerHTML =
          '<div class="ai-welcome">' +

            '<div class="ai-orb">' +
              '🤖' +
            '</div>' +

            '<strong>' +
              'Hey, I\'m Messy AI.' +
            '</strong>' +

            '<span>' +
              'Ask me anything, brainstorm, rewrite a message, or get a caption.' +
            '</span>' +

          '</div>';

      }
    );

  }

})();
```
