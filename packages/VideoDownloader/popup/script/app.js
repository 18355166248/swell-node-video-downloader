const app = new Vue({
    el: "#app",
    data: {
        obj: null,
        page: null,
        videos: [],
        tabId: null,
        text: ''
    },
    created() {
        var self = this;
        chrome.tabs.query({active: !0, currentWindow: !0}, function (b) {
            if(b.length) {
                self.tabId = b[0].id;

                chrome.runtime.sendMessage({msg: 'openPopup'})
                
                    chrome.runtime.sendMessage({msg: 'fetchVideos', tabId: self.tabId}, function (a) {
                    if(a.fetchedVideos) {
                        self.page = a.fetchedVideos.page;
                        self.videos = a.fetchedVideos.videos;
                    }

                    if(b && b[0] && b[0].url && b[0].url.indexOf('youtube.com') !== -1) {
                        self.text = `<div class="empty-container">
                                <div class="main-bottom-text">
                                    YouTube policy <span style="color:red;">does not allow</span><br>
                                    downloading videos directly from YouTube<br>
                                    <small>Try to find this video on another site</small>
                                </div>
                            </div>`;
                    } else {
                        self.text = `<b>Please</b> try to 
                                <span style="color:green">start a playback</span><br/>
                                <small>if you see a video on the page </small><br>
                                <small>This will help to grab the right video file</small>`;
                    }
                    
                });

                
                setInterval(function () {
                    chrome.runtime.sendMessage({msg: 'fetchVideos', tabId: self.tabId}, function (a) {
                        if(a.fetchedVideos) {
                            self.page = a.fetchedVideos.page;
                            self.videos = a.fetchedVideos.videos;
                        }
                    });
                }, 1000);
                

            }

        })
        navigator.serviceWorker.register(chrome.runtime.getManifest().background.service_worker, {scope: '/', type: chrome.runtime.getManifest().background.type})   
    },
    methods: {

        selectVideo(v) {
            var self = this;
            "use strict";
            chrome.runtime.sendMessage({
                msg: 'startDownloading',
                tabId: self.tabId,
                videoId: v
            })
        },

        closeVideo(v) {
            var self = this;
            "use strict";
            chrome.runtime.sendMessage({
                msg: 'closeDownloading',
                tabId: self.tabId,
                videoId: v
            })
        },
        isObjectEmpty(someObject){
            return (Object.keys(someObject).length)
        },
        metaData(event){
            let duration = event.target.duration*1000;
            let time = this.msToHMS(duration);
            let timeElement = event.target.closest(".video-container").querySelector('.time');
            timeElement.innerHTML = time;
        },
        msToHMS(ms) {
            let seconds = ms / 1000;
            let hours = parseInt( seconds / 3600 );
            seconds = seconds % 3600;
            let minutes = parseInt( seconds / 60 );
            seconds = Math.round(seconds % 60);
            
            return hours+"h:"+minutes+"m:"+seconds+"s";
        }
        
    }
});