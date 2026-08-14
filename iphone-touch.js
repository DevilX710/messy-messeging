/* =========================================================
   MESSY — iPHONE TOUCH FIX
   Makes buttons/tabs reliable on iPhone Safari
   ========================================================= */

(function () {

  function setupTouchFix() {

    var tabs = document.querySelectorAll(".tab");

    for (var i = 0; i < tabs.length; i++) {

      (function (tab) {

        var alreadyHandled = false;

        function activateTab(event) {

          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }

          if (alreadyHandled) {
            alreadyHandled = false;
            return;
          }

          alreadyHandled = true;

          var mode = tab.getAttribute("data-auth");

          if (!mode) {
            return;
          }

          /* Update active tab */
          var allTabs = document.querySelectorAll(".tab");

          for (var j = 0; j < allTabs.length; j++) {
            if (allTabs[j] === tab) {
              allTabs[j].classList.add("active");
            } else {
              allTabs[j].classList.remove("active");
            }
          }

          /* Change auth mode used by app.js */
          if (typeof window.authMode !== "undefined") {
            window.authMode = mode;
          }

          /* Username field */
          var username = document.getElementById("username");

          if (username) {

            if (mode === "signup") {
              username.classList.remove("hidden");
              username.removeAttribute("disabled");
              username.style.display = "";
            } else {
              username.classList.add("hidden");
              username.style.display = "none";
            }
          }

          /* Change main button */
          var authButton =
            document.getElementById("authButton");

          if (authButton) {

            if (mode === "signup") {
              authButton.textContent = "Create account";
            } else {
              authButton.textContent = "Log in";
            }
          }

          /* Password autocomplete */
          var password =
            document.getElementById("password");

          if (password) {

            if (mode === "signup") {
              password.setAttribute(
                "autocomplete",
                "new-password"
              );
            } else {
              password.setAttribute(
                "autocomplete",
                "current-password"
              );
            }
          }

          /* Clear old error */
          var authMsg =
            document.getElementById("authMsg");

          if (authMsg) {
            authMsg.textContent = "";
          }

        }

        /* iPhone touch */
        tab.addEventListener(
          "touchend",
          activateTab,
          false
        );

        /* Normal desktop click */
        tab.addEventListener(
          "click",
          function () {

            if (alreadyHandled) {
              alreadyHandled = false;
              return;
            }

            activateTab();

          },
          false
        );

        /* Make it obviously touchable */
        tab.style.cursor = "pointer";
        tab.style.touchAction = "manipulation";
        tab.style.webkitTapHighlightColor =
          "transparent";

      })(tabs[i]);

    }

  }


  /* Wait until the page is ready */
  if (document.readyState === "loading") {

    document.addEventListener(
      "DOMContentLoaded",
      setupTouchFix
    );

  } else {

    setupTouchFix();

  }

})();
