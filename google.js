<html lang="en">
  <head>
    <meta name="google-signin-scope" content="profile email">
    <meta name="google-signin-client_id" content="YOUR_CLIENT_ID.apps.googleusercontent.com">
    <script src="https://apis.google.com/js/platform.js" async defer></script>
  </head>
  <body>
    <meta name="google-signin-client_id" content="1035014666737-qp3uhnmnca11ugeqjp3rpskelo3gmrnf.apps.googleusercontent.com">
    <div class="g-signin2" data-onsuccess="onSignIn" data-theme="dark"></div>
    <script>
      function onSignIn(googleUser) {
        // Useful data for your client-side scripts:
        var profile = googleUser.getBasicProfile();
        console.log("ID: " + profile.getId()); // Don't send this directly to your server!
        console.log('Full Name: ' + profile.getName());
        console.log('Given Name: ' + profile.getGivenName());
        console.log('Family Name: ' + profile.getFamilyName());
        console.log("Image URL: " + profile.getImageUrl());
        console.log("Email: " + profile.getEmail());

        // The ID token you need to pass to your backend:
        var id_token = googleUser.getAuthResponse().id_token;
        console.log("ID Token: " + id_token);
      };
    </script>
    <a href="#" onclick="signOut();">Sign out</a>
    <script>
      function onSignIn(googleUser) {
      var profile = googleUser.getBasicProfile();
      console.log('ID: ' + profile.getId()); // Do not send to your backend! Use an ID token instead.
      console.log('Name: ' + profile.getName());
      console.log('Image URL: ' + profile.getImageUrl());
      console.log('Email: ' + profile.getEmail()); // This is null if the 'email' scope is not present.
      }
      function signOut() {
        var auth2 = gapi.auth2.getAuthInstance();
        auth2.signOut().then(function () {
          console.log('User signed out.');
        });
      }
      if (auth2.isSignedIn.get()) {
        var profile = auth2.currentUser.get().getBasicProfile();
        console.log('ID: ' + profile.getId());
        console.log('Full Name: ' + profile.getName());
        console.log('Given Name: ' + profile.getGivenName());
        console.log('Family Name: ' + profile.getFamilyName());
        console.log('Image URL: ' + profile.getImageUrl());
        console.log('Email: ' + profile.getEmail());
      }
      gapi.load('auth2', function() {
        auth2 = gapi.auth2.init({
          client_id: 'CLIENT_ID.apps.googleusercontent.com',
          fetch_basic_profile: false,
          scope: 'profile'
        });
      
        // Sign the user in, and then retrieve their ID.
        auth2.signIn().then(function() {
          console.log(auth2.currentUser.get().getId());
        });
      });
    </script>
  </body>
</html>