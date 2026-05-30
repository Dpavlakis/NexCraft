// HTML from "index.html"
export const DAEMON_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NexCraft Daemon</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial,
          sans-serif;
        background: linear-gradient(135deg, #162961 0%, #393f98 40%, #5c469c 65%, #1587ac 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: 20px;
      }

      .container {
        background: white;
        border-radius: 8px;
        padding: 48px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        max-width: 540px;
        width: 100%;
        text-align: center;
        transition: all 0.6s;
      }

      .container:hover {
        transform: scale(1.01);
      }

      .logo {
        width: 84px;
        height: 84px;
        margin: 0 auto 14px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .logo svg {
        width: 100%;
        height: 100%;
        filter: drop-shadow(0 4px 10px rgba(22, 41, 97, 0.25));
      }

      .brand {
        font-size: 26px;
        font-weight: 700;
        letter-spacing: 0.5px;
        margin-bottom: 20px;
        background: linear-gradient(90deg, #162961 0%, #393f98 35%, #5c469c 60%, #1587ac 100%);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .title {
        font-size: 22px;
        font-weight: 600;
        color: #1f2937;
        margin-bottom: 16px;
        line-height: 1.4;
      }

      .description {
        font-size: 16px;
        color: #6b7280;
        line-height: 1.6;
        margin-bottom: 12px;
      }

      .link-section {
        margin-top: 24px;
        padding-top: 24px;
        border-top: 1px solid #e5e7eb;
      }

      .link-title {
        font-size: 14px;
        color: #9ca3af;
        margin-bottom: 8px;
        font-weight: 500;
      }

      .link {
        color: #3179bd;
        text-decoration: none;
        font-weight: 500;
        transition: color 0.2s;
      }

      .link:hover {
        color: #1587ac;
        text-decoration: underline;
      }

      .language-switcher {
        margin-top: 32px;
        display: flex;
        justify-content: center;
        gap: 8px;
      }

      .lang-btn {
        padding: 6px 12px;
        border: 1px solid #d1d5db;
        background: white;
        border-radius: 6px;
        color: #6b7280;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
      }

      .lang-btn:hover {
        border-color: #3179bd;
        color: #3179bd;
      }

      .lang-btn.active {
        background: #3179bd;
        border-color: #3179bd;
        color: white;
      }

      @media (max-width: 640px) {
        .container {
          padding: 32px 24px;
          margin: 16px;
        }

        .title {
          font-size: 20px;
        }

        .description {
          font-size: 15px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="logo">
        <svg width="100%" height="100%" viewBox="0 0 511 597" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;"><g><path d="M254.843,578.756c-9.797,-5.859 -19.62,-11.675 -29.385,-17.584c-62.098,-37.58 -124.182,-75.183 -186.276,-112.77c-4.082,-2.47 -8.293,-4.742 -12.252,-7.394c-1.088,-0.728 -1.479,-2.498 -1.938,-4.17c0.433,-0.568 0.615,-0.755 1.071,-0.965c0.857,-0.228 1.505,-0.33 2.013,-0.652c16.05,-10.188 32.055,-20.446 48.139,-30.578c6.234,-3.927 12.642,-7.578 19.229,-11.26c2.531,1.415 4.826,2.7 7.074,4.062c18.113,10.982 36.225,21.966 54.322,32.973c24.95,15.176 49.862,30.412 74.844,45.534c7.708,4.666 15.59,9.045 23.434,13.723c0.042,0.168 0.148,0.497 0.127,0.847c-0.031,28.153 -0.036,55.954 -0.066,83.756c-0.002,1.493 -0.217,2.986 -0.334,4.479Z" style="fill:#7659b0;fill-rule:nonzero;"/><path d="M255.045,578.929c-0.086,-1.666 0.129,-3.159 0.131,-4.652c0.03,-27.802 0.036,-55.603 0.298,-83.866c9.079,-5.768 17.915,-11.059 26.729,-16.389c24.186,-14.623 48.359,-29.267 72.544,-43.893c19.879,-12.022 39.767,-24.029 59.922,-35.976c8.686,5.235 17.123,10.367 25.51,15.579c14.341,8.913 28.649,17.875 43.075,26.991c0.469,0.319 0.834,0.466 1.199,0.613c-0.67,1.266 -1.01,3.07 -2.061,3.717c-19.893,12.254 -39.882,24.351 -59.827,36.519c-49.837,30.404 -99.654,60.843 -149.505,91.226c-5.856,3.569 -11.872,6.874 -18.016,10.13l-0,-0Z" style="fill:#162961;fill-rule:nonzero;"/><path d="M95.185,393.286c-6.329,3.777 -12.737,7.428 -18.971,11.355c-16.084,10.133 -32.089,20.39 -48.139,30.578c-0.508,0.322 -1.156,0.424 -2.031,0.289c-0.584,-4.174 -0.875,-8.009 -1.165,-11.844c-0.056,-12.068 -0.112,-24.136 0.129,-36.704c0.152,-1.435 0.006,-2.369 -0.14,-3.303c-0.064,-0.748 -0.185,-1.497 -0.185,-2.245c0.004,-69.69 0.016,-139.38 0.341,-209.608c0.16,-2.455 0.006,-4.37 -0.148,-6.287c-0.049,-3.267 -0.099,-6.536 0.119,-10.239c0.441,-0.659 0.615,-0.882 1.046,-1.047c20.158,12.174 40.041,24.319 59.977,36.376c3.171,1.918 6.577,3.446 9.883,5.335c0.008,0.181 0.014,0.543 -0.217,0.762c-0.324,0.834 -0.497,1.449 -0.497,2.065c-0.001,64.656 0.011,129.313 0.016,194.106c-0.006,0.137 -0.017,0.411 -0.017,0.411l0,0Z" style="fill:#3179bd;fill-rule:nonzero;"/><path d="M255.283,17.596c4.487,2.416 9.034,4.727 13.448,7.266c15.644,8.997 31.241,18.078 46.862,27.117c17.355,10.042 34.727,20.056 52.075,30.111c17.457,10.118 34.933,20.206 52.328,30.429c14.908,8.762 29.717,17.693 44.565,26.558c5.81,3.468 11.672,6.857 17.357,10.522c1.259,0.811 1.867,2.633 2.491,4.258c-11.822,7.327 -23.352,14.399 -34.899,21.442c-11.654,7.108 -23.326,14.188 -35.152,21.07c-2.401,-1.598 -4.62,-3.021 -6.883,-4.37c-43.566,-25.976 -87.129,-51.957 -130.715,-77.899c-7.108,-4.231 -14.322,-8.284 -21.469,-12.508c0.017,-0.09 -0.101,-0.227 -0.1,-0.579c0.032,-28.04 0.062,-55.728 0.092,-83.417l0,0Z" style="fill:#e0f0f6;fill-rule:nonzero;"/><path d="M255.114,17.424c0.139,27.862 0.109,55.55 -0.15,83.721c-19.695,11.898 -39.191,23.264 -58.62,34.742c-23.749,14.029 -47.453,28.133 -71.154,42.241c-9.794,5.83 -19.533,11.753 -29.297,17.634c-3.297,-1.708 -6.703,-3.236 -9.874,-5.154c-19.935,-12.057 -39.819,-24.202 -60.018,-36.624c-0.302,-0.475 -0.305,-0.643 -0.309,-0.811c5.826,-3.668 11.574,-7.465 17.488,-10.983c37.461,-22.287 74.951,-44.525 112.445,-66.755c32.741,-19.411 65.499,-38.793 98.262,-58.166c0.264,-0.156 0.702,-0.018 1.227,0.155l-0,-0Z" style="fill:#72cdd2;fill-rule:nonzero;"/><path d="M414.519,196.58c11.664,-7.092 23.336,-14.172 34.99,-21.28c11.548,-7.043 23.078,-14.115 34.895,-21.156c0.247,0.617 0.214,1.215 -0.186,2.197c-0.601,1.682 -1.042,2.98 -1.042,4.278c-0.031,91.978 -0.026,183.956 -0.025,275.933c-14.322,-8.942 -28.631,-17.905 -42.971,-26.818c-8.387,-5.213 -16.825,-10.344 -25.496,-15.762c-0.238,-0.497 -0.217,-0.745 -0.175,-1.369c0.021,-10.393 0.022,-20.409 0.023,-30.425c0.001,-13.41 -0.076,-26.821 0.023,-40.231c0.109,-14.778 0.407,-29.554 0.567,-44.332c0.072,-6.622 0.06,-13.245 0,-19.867c-0.185,-20.178 -0.412,-40.355 -0.615,-60.691c0.007,-0.159 0.012,-0.476 0.012,-0.476l0,-0Z" style="fill:#0b6680;fill-rule:nonzero;"/><path d="M483.255,436.724c-0.105,-92.15 -0.109,-184.128 -0.078,-276.106c0,-1.298 0.442,-2.596 0.95,-3.993c0.361,2.031 0.523,4.161 0.523,6.29c0.018,90.111 0.021,180.221 0.023,270.332c0,1.131 -0.032,2.261 -0.134,3.742c-0.451,0.201 -0.816,0.055 -1.285,-0.264l0,0Z" style="fill:#005871;fill-rule:nonzero;"/><path d="M24.814,424.017c0.355,3.483 0.645,7.318 0.954,11.515c-0.162,0.55 -0.344,0.737 -0.707,1.007c-0.225,-4.002 -0.268,-8.086 -0.248,-12.522Z" style="fill:#206bb7;fill-rule:nonzero;"/><path d="M24.81,165.855c0.22,1.58 0.374,3.496 0.294,5.607c-0.276,-1.627 -0.318,-3.449 -0.294,-5.607Z" style="fill:#206bb7;fill-rule:nonzero;"/><path d="M24.803,383.966c0.211,0.626 0.356,1.56 0.285,2.652c-0.261,-0.676 -0.305,-1.51 -0.285,-2.652Z" style="fill:#206bb7;fill-rule:nonzero;"/><path d="M25.435,153.304c0.261,0.037 0.263,0.205 0.308,0.621c-0.132,0.472 -0.307,0.695 -0.674,1.012c-0.093,-0.439 0.008,-0.971 0.366,-1.633Z" style="fill:#206bb7;fill-rule:nonzero;"/><path d="M95.442,393.381c-0.257,-0.095 -0.246,-0.369 -0.011,-0.611c13.897,-8.84 27.541,-17.469 41.228,-26.027c9.96,-6.228 19.979,-12.365 30.233,-18.449c29.352,17.44 58.444,34.786 87.634,52.288c0.275,0.335 0.479,0.471 0.701,0.91c-0.018,3.861 -0.023,7.372 -0.029,10.884c-0.041,25.71 -0.083,51.419 -0.124,77.129c-7.803,-4.511 -15.684,-8.889 -23.392,-13.556c-24.982,-15.122 -49.895,-30.358 -74.844,-45.534c-18.097,-11.007 -36.208,-21.991 -54.322,-32.973c-2.248,-1.362 -4.543,-2.647 -7.074,-4.062l-0,0Z" style="fill:#3580c3;fill-rule:nonzero;"/><path d="M255.116,489.674c0,-25.877 0.041,-51.587 0.083,-77.297c0.005,-3.512 0.011,-7.024 0.06,-11.029c0.042,-0.493 0.077,-0.784 0.107,-0.808c0.03,-0.023 0.072,-0.085 0.332,-0.111c1.071,-0.349 1.947,-0.565 2.686,-1.008c21.831,-13.116 43.63,-26.289 65.483,-39.37c6.447,-3.859 13.042,-7.467 19.837,-11.136c11.82,7.362 23.338,14.723 34.935,21.959c11.911,7.432 23.897,14.741 35.851,22.105c-0.023,0.248 -0.043,0.495 -0.076,0.925c-19.899,12.197 -39.787,24.204 -59.666,36.226c-24.185,14.626 -48.358,29.27 -72.544,43.893c-8.813,5.329 -17.65,10.62 -26.707,16.038c-0.232,0.109 -0.337,-0.22 -0.38,-0.387l0,-0Z" style="fill:#1587ac;fill-rule:nonzero;"/><path d="M166.632,348.202c-9.993,6.177 -20.012,12.314 -29.972,18.542c-13.688,8.558 -27.332,17.186 -41.222,25.889c-0.239,-64.551 -0.251,-129.207 -0.251,-193.863c0,-0.616 0.173,-1.231 0.657,-1.861c17.353,10.224 34.287,20.507 51.287,30.679c6.549,3.918 13.251,7.581 19.871,11.559c-0.002,0.468 0.008,0.736 -0.102,1.35c-0.154,3.61 -0.215,6.873 -0.217,10.136c-0.023,32.523 -0.036,65.047 -0.051,97.57l-0,0Z" style="fill:#124582;fill-rule:nonzero;"/><path d="M167.014,238.946c-6.632,-3.779 -13.334,-7.441 -19.883,-11.359c-17.001,-10.171 -33.934,-20.455 -51.055,-30.897c-0.161,-0.203 -0.167,-0.565 -0.175,-0.747c9.755,-6.062 19.494,-11.985 29.288,-17.815c23.702,-14.108 47.406,-28.213 71.154,-42.241c19.43,-11.478 38.926,-22.844 58.619,-34.391c0.227,-0.131 0.346,0.007 0.316,0.488c-0.035,28.824 -0.039,57.168 -0.282,85.615c-17.667,10.325 -35.084,20.566 -52.527,30.76c-11.798,6.896 -23.635,13.727 -35.454,20.588Z" style="fill:#1497b2;fill-rule:nonzero;"/><path d="M255.234,187.495c0.005,-28.343 0.008,-56.687 0.026,-85.422c7.178,3.744 14.391,7.797 21.499,12.028c43.586,25.942 87.149,51.923 130.715,77.899c2.263,1.349 4.482,2.772 6.883,4.37c0.162,0.21 0.156,0.528 -0.12,0.729c-13.446,8.089 -26.616,15.979 -39.787,23.866c-10.391,6.223 -20.783,12.443 -31.291,18.665c-0.117,0 -0.352,0.03 -0.561,-0.139c-29.261,-17.445 -58.312,-34.721 -87.364,-51.996l-0,0Z" style="fill:#393f98;fill-rule:nonzero;"/><path d="M343.276,239.629c10.392,-6.221 20.784,-12.442 31.175,-18.664c13.171,-7.887 26.341,-15.776 39.78,-23.707c0.479,20.135 0.707,40.312 0.891,60.49c0.06,6.622 0.072,13.245 0,19.867c-0.16,14.778 -0.457,29.554 -0.567,44.332c-0.099,13.41 -0.023,26.821 -0.023,40.231c-0.001,10.016 -0.002,20.032 -0.023,30.425c-11.974,-6.987 -23.96,-14.296 -35.871,-21.728c-11.597,-7.236 -23.115,-14.597 -34.936,-22.299c-0.276,-6.802 -0.283,-13.211 -0.293,-19.618c-0.044,-29.777 -0.088,-59.552 -0.133,-89.329l-0,0Z" style="fill:#5c469c;fill-rule:nonzero;"/><path d="M166.893,348.295c-0.245,-32.616 -0.232,-65.139 -0.21,-97.663c0.002,-3.263 0.063,-6.527 0.491,-10.121c1.417,0.122 2.5,0.472 3.454,1.041c17.753,10.583 35.515,21.151 53.223,31.81c10.512,6.327 20.934,12.805 31.383,19.556c-0.023,34.826 -0.035,69.311 -0.031,103.796c0,1.248 0.153,2.495 0.234,3.743c0,0 -0.042,0.062 -0.296,0.02c-0.407,-0.045 -0.56,-0.047 -0.714,-0.048c-29.091,-17.347 -58.182,-34.693 -87.535,-52.133l-0,0Z" style="fill:#7dd3d4;fill-rule:nonzero;"/><path d="M254.526,400.583c0.055,-0.153 0.208,-0.151 0.586,-0.084c0.223,0.066 0.189,0.357 0.159,0.501c-0.265,0.054 -0.47,-0.082 -0.744,-0.417Z" style="fill:#4cbfc5;fill-rule:nonzero;"/><path d="M255.697,400.431c-0.341,-1.221 -0.494,-2.469 -0.494,-3.717c-0.004,-34.485 0.008,-68.97 0.294,-103.862c8.967,-5.638 17.674,-10.842 26.344,-16.106c20.332,-12.346 40.646,-24.722 60.966,-37.086c0,0 0.235,-0.03 0.352,-0.03c0.161,29.776 0.205,59.552 0.249,89.328c0.01,6.408 0.017,12.816 0.026,19.563c-6.527,4.064 -13.122,7.673 -19.569,11.531c-21.853,13.081 -43.652,26.254 -65.483,39.37c-0.739,0.444 -1.614,0.66 -2.686,1.008l-0,-0Z" style="fill:#4cbfc5;fill-rule:nonzero;"/><path d="M342.598,239.491c-20.111,12.533 -40.425,24.909 -60.757,37.255c-8.67,5.264 -17.377,10.468 -26.33,15.765c-10.726,-6.343 -21.148,-12.822 -31.66,-19.149c-17.708,-10.659 -35.47,-21.228 -53.223,-31.81c-0.954,-0.568 -2.037,-0.919 -3.335,-1.387c-0.284,-0.283 -0.294,-0.551 -0.291,-1.019c11.832,-7.061 23.668,-13.891 35.466,-20.787c17.443,-10.194 34.859,-20.435 52.527,-30.76c29.291,17.171 58.342,34.447 87.603,51.892l0,-0Z" style="fill:#e2f2f7;fill-rule:nonzero;"/></g></svg>
      </div>
      <div class="brand">NexCraft</div>
      <div id="content">
        <h1 class="title" id="title"></h1>
        <p class="description" id="desc1"></p>
        <p class="description" id="desc2"></p>

        <div class="link-section">
          <div class="link-title" id="doc-title"></div>
          <a
            class="link"
            href="https://dpavlakis.github.io/NexCraft/"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://dpavlakis.github.io/NexCraft/
          </a>
        </div>
      </div>

      <div class="language-switcher">
        <button class="lang-btn" data-lang="en-US">English</button>
        <button class="lang-btn" data-lang="zh-CN">中文</button>
        <button class="lang-btn" data-lang="ru-RU">Русский</button>
        <button class="lang-btn" data-lang="fr-FR">Français</button>
      </div>
    </div>

    <script>
      const translations = {
        "zh-CN": {
          title: "NexCraft Daemon 程序运行中",
          desc1:
            "此端口上正在运行的是 NexCraft 的 Daemon 程序，你可以使用 NexCraft 的 Web 端来连接它！",
          desc2:
            "连接协议为 WebSocket，需要配合密钥使用。如果此端口存在反向代理，内网映射等中间层，则需要确保 Websocket 协议能够正常使用。",
          "doc-title": "文档地址："
        },
        "en-US": {
          title: "NexCraft Daemon is Running",
          desc1: "The NexCraft Daemon is running on this port. Connect using the NexCraft Web panel!",
          desc2:
            "Uses the WebSocket protocol with key authentication. Ensure WebSocket works through any reverse proxies or network mappings.",
          "doc-title": "Documentation:"
        },
        "ru-RU": {
          title: "NexCraft Daemon работает",
          desc1:
            "На этом порту работает NexCraft Daemon. Подключитесь через веб-интерфейс NexCraft!",
          desc2:
            "Протокол подключения - WebSocket, требуется ключ. Убедитесь, что WebSocket работает через прокси или сетевые отображения.",
          "doc-title": "Документация:"
        },
        "fr-FR": {
          title: "NexCraft Daemon fonctionne",
          desc1:
            "Le programme NexCraft Daemon fonctionne sur ce port. Connectez-vous via l'interface web NexCraft !",
          desc2:
            "Protocole WebSocket avec clé d'authentification. Assurez-vous que WebSocket fonctionne à travers les proxies ou mappages réseau.",
          "doc-title": "Documentation :"
        }
      };

      function getBrowserLanguage() {
        const lang = navigator.language || navigator.userLanguage;
        if (lang.startsWith("zh")) return "zh-CN";
        if (lang.startsWith("en")) return "en-US";
        if (lang.startsWith("ru")) return "ru-RU";
        if (lang.startsWith("fr")) return "fr-FR";
        return "en-US";
      }

      function setLanguage(lang) {
        const content = translations[lang];
        if (!content) return;

        document.getElementById("title").textContent = content.title;
        document.getElementById("desc1").textContent = content.desc1;
        document.getElementById("desc2").textContent = content.desc2;
        document.getElementById("doc-title").textContent = content["doc-title"];

        document.querySelectorAll(".lang-btn").forEach((btn) => {
          btn.classList.remove("active");
          if (btn.getAttribute("data-lang") === lang) {
            btn.classList.add("active");
          }
        });

        localStorage.setItem("mcsmanager-lang", lang);
      }

      document.addEventListener("DOMContentLoaded", function () {
        let lang = localStorage.getItem("mcsmanager-lang") || getBrowserLanguage();
        setLanguage(lang);

        document.querySelectorAll(".lang-btn").forEach((btn) => {
          btn.addEventListener("click", function () {
            const selectedLang = this.getAttribute("data-lang");
            setLanguage(selectedLang);
          });
        });
      });
    </script>
  </body>
</html>
`;
