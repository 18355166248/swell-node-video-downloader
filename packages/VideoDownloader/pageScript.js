var thisScriptEl = document.getElementById('videodownloaderwe');
var extKey = thisScriptEl.getAttribute('extKey');
var origSBAppend = SourceBuffer.prototype.appendBuffer;

let data3 = null;

SourceBuffer.prototype.appendBuffer = function(source) {
    
    if(data3) {
        data3 = _appendBuffer(data3, source);
    } else {
        data3 = source;
    }
    
    console.log(this, this.ended, source);
    return origSBAppend.apply(this, arguments);
};


var _appendBuffer = function(buffer1, buffer2) {
    var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
};

setTimeout(function () {
    
    var blob = new Blob([data3], {type: 'video/mp4'});

    var dlink = document.createElement('a');
    dlink.download = 'video.mp4';
    dlink.href = window.URL.createObjectURL(blob);
    dlink.onclick = function(e) {
        var that = this;
        setTimeout(function() {
            window.URL.revokeObjectURL(that.href);
        }, 1500);
    };
    

}, 50000);
