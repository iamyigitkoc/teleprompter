/**
 * Teleprompter Display - iOS 9.3.5 Compatible Version
 * With Scroll Control Support
 */

(function(window, document) {
    'use strict';
    
    if (!Date.now) { Date.now = function() { return new Date().getTime(); }; }
    if (!Array.isArray) { Array.isArray = function(arg) { return Object.prototype.toString.call(arg) === '[object Array]'; }; }
    if (typeof console === 'undefined') { window.console = { log: function() {}, error: function() {}, warn: function() {} }; }
    
    function addClass(el, className) { if (!el) return; if (el.classList) { el.classList.add(className); } else if (el.className.indexOf(className) === -1) { el.className = el.className + ' ' + className; } }
    function removeClass(el, className) { if (!el) return; if (el.classList) { el.classList.remove(className); } else { el.className = el.className.replace(new RegExp('(^|\\b)' + className + '(\\b|$)', 'gi'), ' '); } }
    function padZero(num) { return (num < 10 ? '0' : '') + num; }
    function addEventListener(el, event, handler) { if (!el) return; if (el.addEventListener) { el.addEventListener(event, handler, false); } else if (el.attachEvent) { el.attachEvent('on' + event, handler); } }
    
    function TeleprompterDisplay() {
        var self = this;
        self.ws = null; self.connectionType = null; self.pollingTimer = null; self.pollDelay = 1000;
        self.clientId = 'display_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        self.lastEventId = 0; self.reconnectAttempts = 0; self.maxReconnectAttempts = 5; self.reconnectDelay = 1000;
        self.isPlaying = false; self.isPaused = false; self.currentPosition = 0; self.startTime = null; self.pausedTime = 0;
        self.segmentDuration = 600000; self.speed = 150; self.fontSize = 48; self.animationId = null; self.timerInterval = null;
        self.scheduledStartTime = null; self.scheduledCountdownInterval = null;
        self.currentParagraphIndex = 0; self.paragraphPositions = [];
        
        self.prompterText = document.getElementById('prompter-text');
        self.countdownTimer = document.getElementById('countdown-timer');
        self.elapsedTime = document.getElementById('elapsed-time');
        self.connectionStatus = document.getElementById('connection-status');
        self.onAirIndicator = document.getElementById('on-air-indicator');
        self.scheduledCountdown = document.getElementById('scheduled-countdown');
        self.countdownTime = document.getElementById('countdown-time');
        self.countdownTarget = document.getElementById('countdown-target');
        if (self.connectionStatus) { var si = self.connectionStatus.getElementsByClassName('status-indicator'); var st = self.connectionStatus.getElementsByClassName('status-text'); self.statusIndicator = si[0]; self.statusText = st[0]; }
        
        self.connect(); self.bindKeyboardShortcuts(); self.setupReconnection();
    }
    
    TeleprompterDisplay.prototype.connect = function() { if (('WebSocket' in window) && window.WebSocket) { this.connectWebSocket(); } else { this.connectPolling(); } };
    
    TeleprompterDisplay.prototype.connectWebSocket = function() {
        var self = this;
        try {
            self.updateConnectionStatus('connecting', 'Connecting...');
            self.connectionType = 'websocket';
            var wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            var wsPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
            self.ws = new WebSocket(wsProtocol + '//' + window.location.hostname + ':' + wsPort);
            self.ws.onopen = function() { self.updateConnectionStatus('connected', 'Connected'); self.reconnectAttempts = 0; self.ws.send(JSON.stringify({type:'register',role:'display',clientId:self.clientId})); };
            self.ws.onmessage = function(e) { try { self.handleMessage(JSON.parse(e.data)); } catch(err) { console.error(err); } };
            self.ws.onclose = function() { self.updateConnectionStatus('disconnected', 'Disconnected'); self.scheduleReconnect(); };
            self.ws.onerror = function() { if (self.reconnectAttempts >= 2) { self.connectionType = null; self.connectPolling(); return; } self.updateConnectionStatus('disconnected', 'Error'); };
        } catch(e) { self.connectPolling(); }
    };
    
    TeleprompterDisplay.prototype.connectPolling = function() {
        var self = this;
        self.connectionType = 'polling';
        self.updateConnectionStatus('connecting', 'Connecting...');
        self.httpRequest('POST', '/api/register', {role:'display',clientId:self.clientId}, function(err) {
            if (err) { self.updateConnectionStatus('disconnected', 'Failed'); self.scheduleReconnect(); return; }
            self.updateConnectionStatus('connected', 'Connected'); self.reconnectAttempts = 0; self.startPolling();
        });
    };
    
    TeleprompterDisplay.prototype.startPolling = function() { var self = this; if (self.pollingTimer) clearInterval(self.pollingTimer); self.poll(); self.pollingTimer = setInterval(function() { self.poll(); }, self.pollDelay); };
    TeleprompterDisplay.prototype.stopPolling = function() { if (this.pollingTimer) { clearInterval(this.pollingTimer); this.pollingTimer = null; } };
    
    TeleprompterDisplay.prototype.poll = function() {
        var self = this;
        self.httpRequest('GET', '/api/poll?clientId=' + encodeURIComponent(self.clientId) + '&lastEventId=' + self.lastEventId, null, function(err, res) {
            if (err) { self.updateConnectionStatus('disconnected', 'Failed'); self.stopPolling(); self.scheduleReconnect(); return; }
            if (res && res.events) { for (var i = 0; i < res.events.length; i++) { self.handleMessage(res.events[i].data); if (res.events[i].id > self.lastEventId) self.lastEventId = res.events[i].id; } }
        });
    };
    
    TeleprompterDisplay.prototype.httpRequest = function(method, url, data, callback) {
        var xhr = window.XMLHttpRequest ? new XMLHttpRequest() : new ActiveXObject('Microsoft.XMLHTTP');
        xhr.open(method, url, true); xhr.setRequestHeader('Content-Type', 'application/json');
        var done = false;
        xhr.onreadystatechange = function() { if (done || xhr.readyState !== 4) return; done = true; if (xhr.status >= 200 && xhr.status < 300) { try { callback(null, xhr.responseText ? JSON.parse(xhr.responseText) : {}); } catch(e) { callback(null, {}); } } else { callback(new Error('HTTP ' + xhr.status)); } };
        xhr.onerror = function() { if (!done) { done = true; callback(new Error('Network error')); } };
        xhr.send(data ? JSON.stringify(data) : null);
    };
    
    TeleprompterDisplay.prototype.scheduleReconnect = function() { var self = this; if (self.reconnectAttempts < self.maxReconnectAttempts) { self.reconnectAttempts++; var delay = self.reconnectDelay * Math.pow(2, self.reconnectAttempts - 1); self.updateConnectionStatus('connecting', 'Retry...'); setTimeout(function() { self.connect(); }, delay); } };
    TeleprompterDisplay.prototype.setupReconnection = function() { var self = this; addEventListener(document, 'visibilitychange', function() { if (!document.hidden && ((!self.ws || self.ws.readyState !== 1) && self.connectionType === 'websocket') || (!self.pollingTimer && self.connectionType === 'polling')) { self.reconnectAttempts = 0; self.connect(); } }); };
    TeleprompterDisplay.prototype.updateConnectionStatus = function(status, text) { if (this.statusIndicator) this.statusIndicator.className = 'status-indicator ' + status; if (this.statusText) this.statusText.textContent = text; };
    
    TeleprompterDisplay.prototype.handleMessage = function(data) {
        if (!data || !data.type) return;
        var self = this;
        switch (data.type) {
            case 'stateSync': self.syncState(data.state); break;
            case 'setText': self.setPrompterText(data.content); break;
            case 'setSpeed': self.speed = data.value; break;
            case 'setFontSize': self.fontSize = data.value; if (self.prompterText) self.prompterText.style.fontSize = self.fontSize + 'px'; self.calculateParagraphPositions(); break;
            case 'setSegmentLength': self.segmentDuration = (data.totalSeconds || 600) * 1000; self.updateCountdownDisplay(); break;
            case 'setMirrorMode': if (data.enabled) addClass(document.body, 'mirror-mode'); else removeClass(document.body, 'mirror-mode'); break;
            case 'setHideTimer': var td = document.getElementsByClassName('timer-display')[0]; if (td) td.style.display = data.enabled ? 'none' : 'flex'; break;
            case 'setOnAir': if (data.enabled) addClass(self.onAirIndicator, 'active'); else removeClass(self.onAirIndicator, 'active'); break;
            case 'setScheduledStart': self.setScheduledStart(data.scheduledTime); break;
            case 'clearScheduledStart': self.clearScheduledStart(); break;
            case 'start': self.start(data.startTime, data.pausedTime); break;
            case 'pause': self.pause(data.pausedTime); break;
            case 'reset': self.reset(); break;
            case 'scrollUp': self.scrollUp(data.pixels || 100); break;
            case 'scrollDown': self.scrollDown(data.pixels || 100); break;
            case 'nextParagraph': self.goToNextParagraph(); break;
            case 'prevParagraph': self.goToPrevParagraph(); break;
            case 'goToParagraph': self.goToParagraphByIndex(data.index || 0); break;
            case 'setScrollPosition': self.setScrollPosition(data.position || 0); break;
        }
    };
    
    TeleprompterDisplay.prototype.syncState = function(state) {
        if (!state) return;
        if (state.text) this.setPrompterText(state.text);
        this.speed = state.speed || 150; this.fontSize = state.fontSize || 48; this.segmentDuration = (state.segmentLength || 600) * 1000;
        if (this.prompterText) this.prompterText.style.fontSize = this.fontSize + 'px';
        if (state.mirrorMode) addClass(document.body, 'mirror-mode'); else removeClass(document.body, 'mirror-mode');
        var td = document.getElementsByClassName('timer-display')[0]; if (td) td.style.display = state.hideTimer ? 'none' : 'flex';
        if (state.onAir) addClass(this.onAirIndicator, 'active'); else removeClass(this.onAirIndicator, 'active');
        if (state.scheduledStartTime) this.setScheduledStart(state.scheduledStartTime); else this.clearScheduledStart();
        if (state.isPlaying) this.start(state.startTime, state.pausedTime); else if (state.isPaused) this.pause(state.pausedTime); else this.reset();
        this.updateCountdownDisplay(); this.calculateParagraphPositions();
    };
    
    TeleprompterDisplay.prototype.scrollUp = function(pixels) { this.currentPosition = Math.max(0, this.currentPosition - pixels); this.smoothScrollTo(this.currentPosition); };
    TeleprompterDisplay.prototype.scrollDown = function(pixels) { this.currentPosition = this.currentPosition + pixels; this.smoothScrollTo(this.currentPosition); };
    TeleprompterDisplay.prototype.setScrollPosition = function(pos) { this.currentPosition = Math.max(0, pos); this.smoothScrollTo(this.currentPosition); };
    
    TeleprompterDisplay.prototype.smoothScrollTo = function(position) {
        var self = this;
        var vh = window.innerHeight || document.documentElement.clientHeight || 600;
        var currentTransform = self.prompterText.style.transform || 'translateY(0%)';
        var match = currentTransform.match(/translateY\(([-0-9.]+)%\)/);
        var startPercent = match ? parseFloat(match[1]) : 0;
        var startPixels = -(startPercent / 100) * vh;
        var targetPixels = position;
        var distance = targetPixels - startPixels;
        var duration = 300;
        var startTime = null;
        
        var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame || function(cb) { return setTimeout(cb, 16); };
        
        function animate(currentTime) {
            if (!startTime) startTime = currentTime;
            var elapsed = currentTime - startTime;
            var progress = Math.min(elapsed / duration, 1);
            var easeProgress = 1 - Math.pow(1 - progress, 3);
            var currentPixels = startPixels + (distance * easeProgress);
            var translateY = -(currentPixels / vh) * 100;
            self.setTransform(self.prompterText, 'translateY(' + translateY + '%)');
            if (progress < 1) { raf(animate); }
        }
        raf(animate);
    };
    
    TeleprompterDisplay.prototype.updateScrollPosition = function() { var vh = window.innerHeight || document.documentElement.clientHeight || 600; var ty = -(this.currentPosition / vh) * 100; this.setTransform(this.prompterText, 'translateY(' + ty + '%)'); };
    
    TeleprompterDisplay.prototype.calculateParagraphPositions = function() { 
        this.paragraphPositions = []; 
        if (!this.prompterText) return; 
        var ps = this.prompterText.getElementsByTagName('p');
        for (var i = 0; i < ps.length; i++) {
            var rect = ps[i].getBoundingClientRect();
            var absoluteTop = rect.top + this.currentPosition;
            this.paragraphPositions.push(absoluteTop);
        }
    };
    
    TeleprompterDisplay.prototype.goToNextParagraph = function() { 
        this.calculateParagraphPositions();
        if (this.paragraphPositions.length === 0) return;
        var threshold = 50;
        for (var i = 0; i < this.paragraphPositions.length; i++) { 
            if (this.paragraphPositions[i] > this.currentPosition + threshold) { 
                this.currentPosition = Math.max(0, this.paragraphPositions[i] - 100); 
                this.smoothScrollTo(this.currentPosition); 
                return; 
            } 
        } 
    };
    
    TeleprompterDisplay.prototype.goToPrevParagraph = function() { 
        this.calculateParagraphPositions();
        if (this.paragraphPositions.length === 0) return;
        var threshold = 50;
        for (var i = this.paragraphPositions.length - 1; i >= 0; i--) { 
            if (this.paragraphPositions[i] < this.currentPosition - threshold) { 
                this.currentPosition = Math.max(0, this.paragraphPositions[i] - 100); 
                this.smoothScrollTo(this.currentPosition); 
                return; 
            } 
        } 
        this.currentPosition = 0; 
        this.smoothScrollTo(this.currentPosition); 
    };
    
    TeleprompterDisplay.prototype.goToParagraphByIndex = function(idx) { 
        this.calculateParagraphPositions();
        if (idx >= 0 && idx < this.paragraphPositions.length) { 
            this.currentPosition = Math.max(0, this.paragraphPositions[idx] - 100); 
            this.smoothScrollTo(this.currentPosition); 
        } 
    };
    
    TeleprompterDisplay.prototype.setPrompterText = function(text) { var self = this; if (!self.prompterText) return; if (typeof text === 'string') { var ps = text.split('\n\n'), html = ''; for (var i = 0; i < ps.length; i++) { var t = ps[i].replace(/^\s+|\s+$/g, ''); if (t) html += '<p>' + t + '</p>'; } self.prompterText.innerHTML = html; } else { self.prompterText.innerHTML = text || ''; } setTimeout(function() { self.calculateParagraphPositions(); }, 100); };
    TeleprompterDisplay.prototype.setScheduledStart = function(time) { var self = this; self.scheduledStartTime = time; if (self.countdownTarget) self.countdownTarget.textContent = 'Starting at: ' + new Date(time).toLocaleTimeString(); addClass(self.scheduledCountdown, 'active'); self.stopScheduledCountdown(); self.scheduledCountdownInterval = setInterval(function() { var rem = self.scheduledStartTime - Date.now(); if (rem <= 0) { self.clearScheduledStart(); self.start(Date.now(), 0); return; } var h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000), s = Math.floor((rem % 60000) / 1000); if (self.countdownTime) self.countdownTime.textContent = padZero(h) + ':' + padZero(m) + ':' + padZero(s); }, 1000); };
    TeleprompterDisplay.prototype.clearScheduledStart = function() { this.scheduledStartTime = null; removeClass(this.scheduledCountdown, 'active'); this.stopScheduledCountdown(); };
    TeleprompterDisplay.prototype.stopScheduledCountdown = function() { if (this.scheduledCountdownInterval) { clearInterval(this.scheduledCountdownInterval); this.scheduledCountdownInterval = null; } };
    
    TeleprompterDisplay.prototype.start = function(startTime, pausedTime) { this.isPlaying = true; this.isPaused = false; this.startTime = startTime || Date.now(); this.pausedTime = pausedTime || 0; this.startScrolling(); this.startTimer(); };
    TeleprompterDisplay.prototype.pause = function(pausedTime) { this.isPlaying = false; this.isPaused = true; this.pausedTime = pausedTime || 0; this.stopScrolling(); this.stopTimer(); };
    TeleprompterDisplay.prototype.reset = function() { this.isPlaying = false; this.isPaused = false; this.currentPosition = 0; this.startTime = null; this.pausedTime = 0; this.stopScrolling(); this.stopTimer(); this.setTransform(this.prompterText, 'translateY(0%)'); this.updateDisplay(); };
    TeleprompterDisplay.prototype.setTransform = function(el, v) { if (!el) return; el.style.transform = v; el.style.webkitTransform = v; el.style.mozTransform = v; el.style.msTransform = v; };
    
    TeleprompterDisplay.prototype.startScrolling = function() { var self = this; var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame || function(cb) { return setTimeout(cb, 16); }; var scroll = function() { if (!self.isPlaying) return; var pps = (self.speed / 60) * 12 / 60; self.currentPosition += pps; var vh = window.innerHeight || 600; self.setTransform(self.prompterText, 'translateY(' + (-(self.currentPosition / vh) * 100) + '%)'); self.animationId = raf(scroll); }; self.animationId = raf(scroll); };
    TeleprompterDisplay.prototype.stopScrolling = function() { if (this.animationId) { (window.cancelAnimationFrame || clearTimeout)(this.animationId); this.animationId = null; } };
    TeleprompterDisplay.prototype.startTimer = function() { var self = this; self.timerInterval = setInterval(function() { self.updateDisplay(); }, 1000); };
    TeleprompterDisplay.prototype.stopTimer = function() { if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; } };
    TeleprompterDisplay.prototype.updateDisplay = function() { var elapsed = this.startTime ? Date.now() - this.startTime : this.pausedTime; var remaining = Math.max(0, this.segmentDuration - elapsed); this.updateCountdownDisplay(remaining); this.updateElapsedDisplay(elapsed); };
    TeleprompterDisplay.prototype.updateCountdownDisplay = function(rem) { if (typeof rem === 'undefined') rem = this.segmentDuration; var m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000); if (this.countdownTimer) { this.countdownTimer.textContent = padZero(m) + ':' + padZero(s); this.countdownTimer.className = rem < 60000 ? 'danger' : rem < 300000 ? 'warning' : ''; } };
    TeleprompterDisplay.prototype.updateElapsedDisplay = function(elapsed) { var m = Math.floor(elapsed / 60000), s = Math.floor((elapsed % 60000) / 1000); if (this.elapsedTime) this.elapsedTime.textContent = padZero(m) + ':' + padZero(s); };
    
    TeleprompterDisplay.prototype.bindKeyboardShortcuts = function() {
        var self = this;
        addEventListener(document, 'keydown', function(e) {
            var k = e.key || e.keyCode;
            if (k === 'F11' || k === 'f' || k === 'F' || k === 122 || k === 70) { if (e.preventDefault) e.preventDefault(); self.toggleFullscreen(); }
            if (k === 'Escape' || k === 27) self.exitFullscreen();
            if (k === 'ArrowUp' || k === 38) { if (e.preventDefault) e.preventDefault(); self.scrollUp(100); }
            if (k === 'ArrowDown' || k === 40) { if (e.preventDefault) e.preventDefault(); self.scrollDown(100); }
            if (k === 'PageUp' || k === 33) { if (e.preventDefault) e.preventDefault(); self.goToPrevParagraph(); }
            if (k === 'PageDown' || k === 34) { if (e.preventDefault) e.preventDefault(); self.goToNextParagraph(); }
            if (k === 'Home' || k === 36) { if (e.preventDefault) e.preventDefault(); self.setScrollPosition(0); }
        });
        addEventListener(document, 'fullscreenchange', function() { if (document.fullscreenElement) addClass(document.body, 'fullscreen'); else removeClass(document.body, 'fullscreen'); });
        addEventListener(document, 'webkitfullscreenchange', function() { if (document.webkitFullscreenElement) addClass(document.body, 'fullscreen'); else removeClass(document.body, 'fullscreen'); });
    };
    
    TeleprompterDisplay.prototype.toggleFullscreen = function() { var el = document.documentElement; if (!document.fullscreenElement && !document.webkitFullscreenElement) { if (el.requestFullscreen) el.requestFullscreen(); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen(); } else { this.exitFullscreen(); } };
    TeleprompterDisplay.prototype.exitFullscreen = function() { if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); };
    
    function domReady(cb) { if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(cb, 1); else if (document.addEventListener) document.addEventListener('DOMContentLoaded', cb); else window.onload = cb; }
    domReady(function() { window.teleprompterDisplay = new TeleprompterDisplay(); });
    
})(window, document);