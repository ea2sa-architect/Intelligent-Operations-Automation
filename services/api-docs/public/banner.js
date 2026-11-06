// Replaces the default Swagger topbar content with the Ea-2-Sa brand
window.addEventListener('load', function () {
  var interval = setInterval(function () {
    var link = document.querySelector('.topbar-wrapper .link');
    if (!link) return;
    clearInterval(interval);

    link.href = '/api/api-docs';
    link.innerHTML =
      '<img src="/api/api-docs/ea2sa-logo.png"' +
      ' style="height:38px;background:#fff;border-radius:6px;padding:3px 12px;display:block;" alt="Ea-2-Sa" />' +
      '<span style="color:rgba(255,255,255,0.75);font-size:11px;font-weight:600;' +
      'letter-spacing:0.1em;text-transform:uppercase;margin-left:16px;' +
      'padding-left:16px;border-left:1px solid rgba(255,255,255,0.25);white-space:nowrap;">' +
      'IOA Governance Platform</span>';
  }, 100);
});
