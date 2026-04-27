function showSection(id, btnElement) {
    document.querySelectorAll("section").forEach(sec => sec.classList.remove("active"));
    document.querySelectorAll(".nav-bar button").forEach(btn => btn.classList.remove("active-btn"));
    
    document.getElementById(id).classList.add("active");
    if(btnElement) {
        btnElement.classList.add("active-btn");
    }
    
    window.scrollTo({
        top: document.querySelector('header').offsetHeight,
        behavior: 'smooth'
    });
}

function openCategory(evt, categoryName) {
    // Esconde todas as categorias
    var contents = document.getElementsByClassName("category-content");
    for (var i = 0; i < contents.length; i++) {
        contents[i].classList.remove("active-category");
    }

    // Remove a classe 'active-tab' de todos os botões
    var tabs = document.getElementsByClassName("tab-btn");
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove("active-tab");
    }

    // Mostra a categoria atual e adiciona a classe 'active-tab' ao botão clicado
    document.getElementById(categoryName).classList.add("active-category");
    evt.currentTarget.classList.add("active-tab");
}

function isTikTokInAppBrowser() {
    // Modo de teste: adicione ?aviso=1 na URL para forçar o aviso aparecer
    if (new URLSearchParams(window.location.search).get("aviso") === "1") {
        return true;
    }
    var ua = navigator.userAgent.toLowerCase();
    return ua.includes("tiktok") ||
           ua.includes("musical_ly") ||
           ua.includes("bytedance") ||
           ua.includes("aweme") ||
           ua.includes("bytelocale") ||
           ua.includes("bytedancewebview");
}

function setupTikTokNotice() {
    var notice = document.getElementById("tiktok-notice");
    var closeButton = document.getElementById("tiktok-notice-close");

    if (!notice || !closeButton || !isTikTokInAppBrowser()) {
        return;
    }

    notice.hidden = false;
    notice.classList.add("is-visible");

    closeButton.addEventListener("click", function () {
        notice.classList.remove("is-visible");
        notice.hidden = true;
    });
}

document.addEventListener("DOMContentLoaded", setupTikTokNotice);
