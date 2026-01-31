

chrome.runtime.onMessage.addListener(async function(message, sender, sendResponse) {
    
    document.getElementById("ads-text").dataset.manifest = message.a.url;
    document.getElementById("ads-text").dataset.wasm = message.wasm;
    document.getElementById("ads-text").dataset.core = message.core;

    // var s = document.createElement('script');
    // s.src = '/js/app.js';
    // s.onload = function () {
    //     this.remove();
    // };
    // (document.head || document.documentElement).appendChild(s);

});