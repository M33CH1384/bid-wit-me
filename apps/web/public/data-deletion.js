// Shows the status of a Facebook data deletion request when the page is opened with ?code=<confirmation code>.
(function () {
  var code = new URLSearchParams(location.search).get('code');
  if (!code) return;
  var box = document.getElementById('status');
  box.hidden = false;
  box.textContent = 'Checking request ' + code + '…';
  fetch('/api/auth/deletion-status?code=' + encodeURIComponent(code))
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j.found) { box.textContent = 'No deletion request found for code ' + code + '.'; return; }
      var when = new Date(j.at).toLocaleString();
      box.textContent = j.status === 'deleted'
        ? 'Request ' + code + ': completed on ' + when + '. Your Facebook login and the data we received from Facebook have been deleted.'
        : 'Request ' + code + ': received on ' + when + '. We had no data linked to that Facebook account, so there was nothing to delete.';
    })
    .catch(function () { box.textContent = "Couldn't check the status right now. Please try again later."; });
})();
