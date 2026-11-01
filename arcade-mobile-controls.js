/* Option d'affichage mobile : masque les contrôles des 12 jeux gratuits.
   Sans effet sur les autres jeux et sur ordinateur. */
(function () {
    'use strict';
    var GAMES = {
        '/course-anneaux.html': '#live, #snd',
        '/combat-retro.html': '#panel, #snd',
        '/pendu.html': '#winners-panel, #winners-restore, .side-card',
        '/pendu': '#winners-panel, #winners-restore, .side-card',
        '/mots-associes.html': '#cfg, #cfgToggle',
        '/qui-veut-gagner-des-etoiles.html': '.tiktok-panel, .game-topbar-controls',
        '/lion-temple-maya.html': '#panel, #qwin',
        '/petits-chevaux-tiktok.html': '.side',
        '/jeu-foot-tiktok.html': '.side-panel',
        '/super-mario-live.html': '#gear, #settings',
        '/course-de-billes.html': '#panel',
        '/flipper-neon.html': '#cfg, #cfgBtn',
        '/bouteilles-colorees.html': '#panel'
    };
    var selectors = GAMES[location.pathname];
    if (!selectors) return;

    var style = document.createElement('style');
    style.textContent =
        '#arcadeMobileControlsToggle{display:none}' +
        '@media (max-width:767px){' +
        '#arcadeMobileControlsToggle{display:flex;position:fixed;left:8px;bottom:8px;z-index:2147483000;width:40px;height:40px;' +
        'align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.4);border-radius:50%;' +
        'background:rgba(0,0,0,.6);color:#fff;font-size:20px;line-height:1;padding:0;cursor:pointer}' +
        'html.arcade-controls-hidden :is(' + selectors + '){display:none!important}}';
    document.head.appendChild(style);

    function mount() {
        var button = document.createElement('button');
        button.id = 'arcadeMobileControlsToggle';
        button.type = 'button';
        function render() {
            var hidden = document.documentElement.classList.contains('arcade-controls-hidden');
            button.textContent = hidden ? '🙈' : '👁';
            button.title = hidden ? 'Afficher les contrôles' : 'Masquer les contrôles';
            button.setAttribute('aria-label', button.title);
            button.setAttribute('aria-pressed', String(hidden));
        }
        button.addEventListener('click', function () {
            document.documentElement.classList.toggle('arcade-controls-hidden');
            render();
            setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 50);
        });
        render();
        document.body.appendChild(button);
    }
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();
