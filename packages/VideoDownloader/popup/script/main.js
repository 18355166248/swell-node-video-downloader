var TubeDownloaderPopup = function () {
    var page, videos = {}, a;
        
        
    var initList = function () {
        var a = document.getElementById('content');
        var innerHtml = '';
     

        if(videos && Object.keys(videos).length === 0 && videos.constructor === Object) {

            let queryOptions = { active: true, currentWindow: true };
            chrome.tabs.query(queryOptions , function (tab) {
                if(tab && tab[0] && tab[0].url && tab[0].url.indexOf('youtube.com') !== -1) {
                    a.innerHTML = `
                            <div class="empty-container">
                                <div class="main-bottom-text">
                                    YouTube policy <span style="color:red;">does not allow</span><br>
                                    downloading videos directly from YouTube<br>
                                    <small>Try to find this video on another site</small>
                                </div>
                            </div>`;
                } else {
                    a.innerHTML = `
                        <div class="empty-container">
                            <div class="main-bottom-text">
                                <b>Please</b> try to <span style="color:green">start a playback</span><br/> 
                                <small>if you see a video on the page </small><br>
                                <small>This will help to grab the right video file</small>
                            </div>
                        </div>`;
                }
                
            });
            
        } else {

            for(var i in videos) {

                innerHtml += `<li class="video-container" data-id-video="${i}">
                            <div><small>${videos[i].filename.substr(0,30)}</small> <br/> ${videos[i].formattedSize} <br/> <b>${videos[i].type}</b> </div>
                            <div>
                                <video width="50" muted ${videos[i].type == 'hls'? 'poster="images/video-player.png"':'poster' } >
                                    <source src="${videos[i].url}">
                                    Your browser does not support the video tag.
                                </video>
                            </div>
                            <div class="persent" id="id_${i}" style="color: royalblue">
                                ${videos[i].persent?videos[i].persent:''}
                            </div>
                            <div class="btn-download" title="download video" id="btn_${i}">
                                ${videos[i].persent?'<span class="btna">⤫</span><span class="btna">⤓</span>':''}
                            </div>
                        </li>`;

            }

            a.innerHTML = innerHtml;
            
        }
        
        
    };

    setTimeout(function () {
        document.querySelectorAll('.video-container').forEach(item => {
            item.addEventListener('click', (event) => {
                chrome.runtime.sendMessage({
                    msg: 'startDownloading',
                    tabId: a,
                    videoId: item.getAttribute('data-id-video')
                })
            })
        });
    }, 1000);
    
    
    
    chrome.tabs.query({active: !0, currentWindow: !0}, function (b) {

        if(b.length) {
            a = b[0].id;

            chrome.runtime.sendMessage({msg: 'fetchVideos', tabId: a}, function (a) {
                a.fetchedVideos && (page = a.fetchedVideos.page, videos = a.fetchedVideos.videos);
                initList();
            });


            setInterval(function () {
                console.log(a);
                chrome.runtime.sendMessage({msg: 'fetchVideos', tabId: a}, function (a) {
                    if(a.fetchedVideos) {
                        for(var i in a.fetchedVideos.videos) {
                            if(a.fetchedVideos.videos[i].persent && a.fetchedVideos.videos[i].persent != videos[i].persent) {
                                videos[i].persent = a.fetchedVideos.videos[i].persent;
                                document.getElementById('id_'+i).innerHTML = videos[i].persent;
                                document.getElementById('btn_'+i).innerHTML = '<span class="btna">⤫</span>';
                            } else if (!a.fetchedVideos.videos[i].persent && videos[i].persent){
                                videos[i].persent = null;
                                document.getElementById('id_'+i).innerHTML = '';
                                document.getElementById('btn_'+i).innerHTML = '<span class="btna">⤓</span>';
                            }
                        }
                    }

                })
            }, 1000);
            
        }
            
    })
}();