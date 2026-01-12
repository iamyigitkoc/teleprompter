/**
 * Teleprompter Display - iOS 9.3.5 Compatible Version
 * 
 * Compatibility: iOS 9+, Safari 9+, IE9+, Android 4.4+
 * 
 * This version avoids:
 * - Promises (buggy on iOS 9.3.x)
 * - const/let (use var only)
 * - Arrow functions
 * - Template literals
 * - Default parameters
 * - Spread operator
 * - Object shorthand
 * - Array methods like find, includes
 * - classList (polyfilled inline)
 */

(function(window, document) {
    'use strict';
    
    // ========================================
    // Polyfills for older browsers
    // ========================================
    
    // Date.now polyfill
    if (!Date.now) {
        Date.now = function() {
            return new Date().getTime();
        };
    }
    
    // Array.isArray polyfill
    if (!Array.isArray) {
        Array.isArray = function(arg) {
            return Object.prototype.toString.call(arg) === '[object Array]';
        };
    }
    
    // JSON polyfill check (should exist in iOS 9)
    if (typeof JSON === 'undefined') {
        window.JSON = {
            parse: function(str) {
                return eval('(' + str + ')');
            },
            stringify: function(obj) {
                var t = typeof obj;
                if (t !== 'object' || obj === null) {
                    if (t === 'string') obj = '"' + obj + '"';
                    return String(obj);
                }
                var n, v, json = [], arr = Array.isArray(obj);
                for (n in obj) {
                    if (obj.hasOwnProperty(n)) {
                        v = obj[n];
                        t = typeof v;
                        if (t === 'string') v = '"' + v + '"';
                        else if (t === 'object' && v !== null) v = JSON.stringify(v);
                        json.push((arr ? '' : '"' + n + '":') + String(v));
                    }
                }
                return (arr ? '[' : '{') + String(json) + (arr ? ']' : '}');
            }
        };
    }
    
    // console polyfill
    if (typeof console === 'undefined') {
        window.console = {
            log: function() {},
            error: function() {},
            warn: function() {}
        };
    }
    
    // ========================================
    // Helper Functions
    // ========================================
    
    function hasClass(el, className) {
        if (!el) return false;
        if (el.classList) {
            return el.classList.contains(className);
        }
        return new RegExp('(^| )' + className + '( |$)', 'gi').test(el.className);
    }
    
    function addClass(el, className) {
        if (!el) return;
        if (el.classList) {
            el.classList.add(className);
        } else if (!hasClass(el, className)) {
            el.className = el.className + ' ' + className;
        }
    }
    
    function removeClass(el, className) {
        if (!el) return;
        if (el.classList) {
            el.classList.remove(className);
        } else {
            el.className = el.className.replace(new RegExp('(^|\\b)' + className.split(' ').join('|') + '(\\b|$)', 'gi'), ' ');
        }
    }
    
    function padZero(num) {
        return (num < 10 ? '0' : '') + num;
    }
    
    function addEventListener(el, event, handler) {
        if (!el) return;
        if (el.addEventListener) {
            el.addEventListener(event, handler, false);
        } else if (el.attachEvent) {
            el.attachEvent('on' + event, handler);
        } else {
            el['on' + event] = handler;
        }
    }
    
    function getQueryString(url) {
        var queryIndex = url.indexOf('?');
        if (queryIndex === -1) return {};
        
        var queryString = url.slice(queryIndex + 1);
        var params = {};
        var pairs = queryString.split('&');
        
        for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i].split('=');
            var key = decodeURIComponent(pair[0]);
            var value = pair[1] ? decodeURIComponent(pair[1]) : '';
            params[key] = value;
        }
        
        return params;
    }
    
    // ========================================
    // TeleprompterDisplay Class
    // ========================================
    
    function TeleprompterDisplay() {
        var self = this;
        
        // Connection state
        self.ws = null;
        self.connectionType = null; // 'websocket' or 'polling'
        self.pollingTimer = null;
        self.pollDelay = 1000;
        self.clientId = self.generateClientId();
        self.lastEventId = 0;
        self.reconnectAttempts = 0;
        self.maxReconnectAttempts = 5;
        self.reconnectDelay = 1000;
        self.reconnectTimer = null;
        
        // Playback state
        self.isPlaying = false;
        self.isPaused = false;
        self.currentPosition = 0;
        self.startTime = null;
        self.pausedTime = 0;
        self.segmentDuration = 10 * 60 * 1000;
        self.speed = 150;
        self.fontSize = 48;
        self.animationId = null;
        self.timerInterval = null;
        self.scheduledStartTime = null;
        self.scheduledCountdownInterval = null;
        
        // Initialize
        self.initializeElements();
        self.connect();
        self.bindKeyboardShortcuts();
        self.setupReconnection();
    }
    
    TeleprompterDisplay.prototype.generateClientId = function() {
        var random = Math.random().toString(36).substr(2, 9);
        var timestamp = Date.now();
        return 'display_' + random + '_' + timestamp;
    };
    
    TeleprompterDisplay.prototype.initializeElements = function() {
        this.prompterText = document.getElementById('prompter-text');
        this.countdownTimer = document.getElementById('countdown-timer');
        this.elapsedTime = document.getElementById('elapsed-time');
        this.connectionStatus = document.getElementById('connection-status');
        this.onAirIndicator = document.getElementById('on-air-indicator');
        this.scheduledCountdown = document.getElementById('scheduled-countdown');
        this.countdownTime = document.getElementById('countdown-time');
        this.countdownTarget = document.getElementById('countdown-target');
        
        if (this.connectionStatus) {
            this.statusIndicator = this.connectionStatus.getElementsByClassName('status-indicator')[0];
            this.statusText = this.connectionStatus.getElementsByClassName('status-text')[0];
        }
    };
    
    // ========================================
    // Connection Management
    // ========================================
    
    TeleprompterDisplay.prototype.connect = function() {
        var self = this;
        
        // Check WebSocket support
        if (self.supportsWebSocket()) {
            self.connectWebSocket();
        } else {
            console.log('WebSocket not supported, using polling');
            self.connectPolling();
        }
    };
    
    TeleprompterDisplay.prototype.supportsWebSocket = function() {
        try {
            return ('WebSocket' in window) && (window.WebSocket !== undefined) && (window.WebSocket !== null);
        } catch (e) {
            return false;
        }
    };
    
    // ========================================
    // WebSocket Connection
    // ========================================
    
    TeleprompterDisplay.prototype.connectWebSocket = function() {
        var self = this;
        
        try {
            self.updateConnectionStatus('connecting', 'Connecting (WS)...');
            self.connectionType = 'websocket';
            
            var wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            var wsPort = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
            var wsUrl = wsProtocol + '//' + window.location.hostname + ':' + wsPort;
            
            self.ws = new WebSocket(wsUrl);
            
            self.ws.onopen = function() {
                console.log('WebSocket connected');
                self.updateConnectionStatus('connected', 'Connected (WS)');
                self.reconnectAttempts = 0;
                
                self.ws.send(JSON.stringify({
                    type: 'register',
                    role: 'display',
                    clientId: self.clientId
                }));
            };
            
            self.ws.onmessage = function(event) {
                try {
                    var data = JSON.parse(event.data);
                    self.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            };
            
            self.ws.onclose = function() {
                console.log('WebSocket closed');
                self.updateConnectionStatus('disconnected', 'Disconnected');
                self.scheduleReconnect();
            };
            
            self.ws.onerror = function(error) {
                console.error('WebSocket error:', error);
                
                // After 2 WebSocket failures, try polling
                if (self.reconnectAttempts >= 2) {
                    console.log('Switching to polling fallback');
                    self.connectionType = null;
                    self.connectPolling();
                    return;
                }
                
                self.updateConnectionStatus('disconnected', 'Error');
            };
            
        } catch (error) {
            console.error('WebSocket failed:', error);
            self.updateConnectionStatus('disconnected', 'WS Failed');
            self.connectPolling();
        }
    };
    
    // ========================================
    // HTTP Polling Connection (Callback-based)
    // ========================================
    
    TeleprompterDisplay.prototype.connectPolling = function() {
        var self = this;
        
        self.connectionType = 'polling';
        self.updateConnectionStatus('connecting', 'Connecting (Poll)...');
        
        // Register with server
        self.httpRequest('POST', '/api/register', {
            role: 'display',
            clientId: self.clientId
        }, function(error, response) {
            if (error) {
                console.error('Polling registration failed:', error);
                self.updateConnectionStatus('disconnected', 'Failed');
                self.scheduleReconnect();
                return;
            }
            
            console.log('Polling registered');
            self.updateConnectionStatus('connected', 'Connected (Poll)');
            self.reconnectAttempts = 0;
            self.startPolling();
        });
    };
    
    TeleprompterDisplay.prototype.startPolling = function() {
        var self = this;
        
        self.stopPolling();
        
        // Initial poll
        self.poll();
        
        // Continue polling
        self.pollingTimer = setInterval(function() {
            self.poll();
        }, self.pollDelay);
    };
    
    TeleprompterDisplay.prototype.stopPolling = function() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
    };
    
    TeleprompterDisplay.prototype.poll = function() {
        var self = this;
        
        var url = '/api/poll?clientId=' + encodeURIComponent(self.clientId) + 
                  '&lastEventId=' + self.lastEventId;
        
        self.httpRequest('GET', url, null, function(error, response) {
            if (error) {
                console.error('Poll error:', error);
                self.updateConnectionStatus('disconnected', 'Poll Failed');
                self.stopPolling();
                self.scheduleReconnect();
                return;
            }
            
            if (response && response.events && response.events.length > 0) {
                for (var i = 0; i < response.events.length; i++) {
                    var event = response.events[i];
                    self.handleMessage(event.data);
                    if (event.id > self.lastEventId) {
                        self.lastEventId = event.id;
                    }
                }
            }
        });
    };
    
    // ========================================
    // HTTP Request (Callback-based, no Promises)
    // ========================================
    
    TeleprompterDisplay.prototype.httpRequest = function(method, url, data, callback) {
        var xhr;
        
        // Create XMLHttpRequest
        if (window.XMLHttpRequest) {
            xhr = new XMLHttpRequest();
        } else if (window.ActiveXObject) {
            try {
                xhr = new ActiveXObject('Msxml2.XMLHTTP');
            } catch (e) {
                try {
                    xhr = new ActiveXObject('Microsoft.XMLHTTP');
                } catch (e2) {
                    callback(new Error('XMLHttpRequest not supported'));
                    return;
                }
            }
        } else {
            callback(new Error('XMLHttpRequest not supported'));
            return;
        }
        
        xhr.open(method, url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        
        // Timeout
        if (typeof xhr.timeout !== 'undefined') {
            xhr.timeout = 30000;
        }
        
        var completed = false;
        
        xhr.onreadystatechange = function() {
            if (completed) return;
            
            if (xhr.readyState === 4) {
                completed = true;
                
                if (xhr.status >= 200 && xhr.status < 300) {
                    var response = null;
                    try {
                        if (xhr.responseText) {
                            response = JSON.parse(xhr.responseText);
                        }
                    } catch (e) {
                        response = {};
                    }
                    callback(null, response);
                } else {
                    callback(new Error('HTTP ' + xhr.status));
                }
            }
        };
        
        xhr.onerror = function() {
            if (completed) return;
            completed = true;
            callback(new Error('Network error'));
        };
        
        if (typeof xhr.ontimeout !== 'undefined') {
            xhr.ontimeout = function() {
                if (completed) return;
                completed = true;
                callback(new Error('Timeout'));
            };
        }
        
        if (data) {
            xhr.send(JSON.stringify(data));
        } else {
            xhr.send();
        }
    };
    
    // ========================================
    // Reconnection Logic
    // ========================================
    
    TeleprompterDisplay.prototype.scheduleReconnect = function() {
        var self = this;
        
        if (self.reconnectTimer) {
            clearTimeout(self.reconnectTimer);
        }
        
        if (self.reconnectAttempts < self.maxReconnectAttempts) {
            self.reconnectAttempts++;
            var delay = self.reconnectDelay * Math.pow(2, self.reconnectAttempts - 1);
            
            self.updateConnectionStatus('connecting', 'Retry in ' + Math.ceil(delay / 1000) + 's...');
            
            self.reconnectTimer = setTimeout(function() {
                self.connect();
            }, delay);
        } else {
            self.updateConnectionStatus('disconnected', 'Max retries');
        }
    };
    
    TeleprompterDisplay.prototype.setupReconnection = function() {
        var self = this;
        
        // Reconnect when page becomes visible
        var handleVisibilityChange = function() {
            var hidden = document.hidden || document.webkitHidden || document.mozHidden || document.msHidden;
            
            if (!hidden) {
                var needsReconnect = false;
                
                if (self.connectionType === 'websocket') {
                    needsReconnect = !self.ws || self.ws.readyState !== 1; // 1 = OPEN
                } else if (self.connectionType === 'polling') {
                    needsReconnect = !self.pollingTimer;
                } else {
                    needsReconnect = true;
                }
                
                if (needsReconnect) {
                    self.reconnectAttempts = 0;
                    self.connect();
                }
            }
        };
        
        addEventListener(document, 'visibilitychange', handleVisibilityChange);
        addEventListener(document, 'webkitvisibilitychange', handleVisibilityChange);
        addEventListener(document, 'mozvisibilitychange', handleVisibilityChange);
        addEventListener(document, 'msvisibilitychange', handleVisibilityChange);
    };
    
    // ========================================
    // Message Handling
    // ========================================
    
    TeleprompterDisplay.prototype.handleMessage = function(data) {
        var self = this;
        
        if (!data || !data.type) return;
        
        switch (data.type) {
            case 'stateSync':
                self.syncState(data.state);
                break;
                
            case 'setText':
                self.setPrompterText(data.content);
                break;
                
            case 'setSpeed':
                self.speed = data.value;
                break;
                
            case 'setFontSize':
                self.fontSize = data.value;
                if (self.prompterText) {
                    self.prompterText.style.fontSize = self.fontSize + 'px';
                }
                break;
                
            case 'setSegmentLength':
                self.segmentDuration = (data.totalSeconds || data.value || 600) * 1000;
                self.updateCountdownDisplay();
                break;
                
            case 'setMirrorMode':
                self.setMirrorMode(data.enabled);
                break;
                
            case 'setHideTimer':
                self.setHideTimer(data.enabled);
                break;
                
            case 'setOnAir':
                self.setOnAir(data.enabled);
                break;
                
            case 'setScheduledStart':
                self.setScheduledStart(data.scheduledTime);
                break;
                
            case 'clearScheduledStart':
                self.clearScheduledStart();
                break;
                
            case 'start':
                self.start(data.startTime, data.pausedTime);
                break;
                
            case 'pause':
                self.pause(data.pausedTime);
                break;
                
            case 'reset':
                self.reset();
                break;
                
            case 'pong':
                // Heartbeat response
                break;
                
            default:
                console.log('Unknown message:', data.type);
        }
    };
    
    TeleprompterDisplay.prototype.syncState = function(state) {
        var self = this;
        
        if (!state) return;
        
        console.log('Syncing state');
        
        if (state.text) {
            self.setPrompterText(state.text);
        }
        
        self.speed = state.speed || 150;
        self.fontSize = state.fontSize || 48;
        self.segmentDuration = (state.segmentLength || 600) * 1000;
        
        if (self.prompterText) {
            self.prompterText.style.fontSize = self.fontSize + 'px';
        }
        
        self.setMirrorMode(state.mirrorMode);
        self.setHideTimer(state.hideTimer);
        self.setOnAir(state.onAir);
        
        if (state.scheduledStartTime) {
            self.setScheduledStart(state.scheduledStartTime);
        } else {
            self.clearScheduledStart();
        }
        
        if (state.isPlaying) {
            self.start(state.startTime, state.pausedTime);
        } else if (state.isPaused) {
            self.pause(state.pausedTime);
        } else {
            self.reset();
        }
        
        self.updateCountdownDisplay();
    };
    
    // ========================================
    // Display Methods
    // ========================================
    
    TeleprompterDisplay.prototype.setPrompterText = function(text) {
        if (!this.prompterText) return;
        
        if (typeof text === 'string') {
            var paragraphs = text.split('\n\n');
            var html = '';
            
            for (var i = 0; i < paragraphs.length; i++) {
                var trimmed = paragraphs[i].replace(/^\s+|\s+$/g, '');
                if (trimmed.length > 0) {
                    html += '<p>' + trimmed + '</p>';
                }
            }
            
            this.prompterText.innerHTML = html;
        } else {
            this.prompterText.innerHTML = text || '';
        }
    };
    
    TeleprompterDisplay.prototype.setMirrorMode = function(enabled) {
        if (enabled) {
            addClass(document.body, 'mirror-mode');
        } else {
            removeClass(document.body, 'mirror-mode');
        }
    };
    
    TeleprompterDisplay.prototype.setHideTimer = function(enabled) {
        var timerDisplay = document.getElementsByClassName('timer-display')[0];
        if (timerDisplay) {
            timerDisplay.style.display = enabled ? 'none' : 'flex';
        }
    };
    
    TeleprompterDisplay.prototype.setOnAir = function(enabled) {
        if (this.onAirIndicator) {
            if (enabled) {
                addClass(this.onAirIndicator, 'active');
            } else {
                removeClass(this.onAirIndicator, 'active');
            }
        }
    };
    
    TeleprompterDisplay.prototype.setScheduledStart = function(scheduledTime) {
        var self = this;
        
        self.scheduledStartTime = scheduledTime;
        
        if (self.countdownTarget) {
            var targetDate = new Date(scheduledTime);
            self.countdownTarget.textContent = 'Starting at: ' + targetDate.toLocaleTimeString();
        }
        
        addClass(self.scheduledCountdown, 'active');
        self.startScheduledCountdown();
    };
    
    TeleprompterDisplay.prototype.clearScheduledStart = function() {
        this.scheduledStartTime = null;
        removeClass(this.scheduledCountdown, 'active');
        this.stopScheduledCountdown();
    };
    
    TeleprompterDisplay.prototype.startScheduledCountdown = function() {
        var self = this;
        
        self.stopScheduledCountdown();
        
        self.scheduledCountdownInterval = setInterval(function() {
            var now = Date.now();
            var timeRemaining = self.scheduledStartTime - now;
            
            if (timeRemaining <= 0) {
                self.clearScheduledStart();
                self.autoStart();
                return;
            }
            
            var hours = Math.floor(timeRemaining / (1000 * 60 * 60));
            var minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
            var seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
            
            if (self.countdownTime) {
                self.countdownTime.textContent = padZero(hours) + ':' + padZero(minutes) + ':' + padZero(seconds);
            }
        }, 1000);
    };
    
    TeleprompterDisplay.prototype.stopScheduledCountdown = function() {
        if (this.scheduledCountdownInterval) {
            clearInterval(this.scheduledCountdownInterval);
            this.scheduledCountdownInterval = null;
        }
    };
    
    TeleprompterDisplay.prototype.autoStart = function() {
        this.start(Date.now(), 0);
    };
    
    // ========================================
    // Playback Control
    // ========================================
    
    TeleprompterDisplay.prototype.start = function(startTime, pausedTime) {
        this.isPlaying = true;
        this.isPaused = false;
        this.startTime = startTime || Date.now();
        this.pausedTime = pausedTime || 0;
        
        this.startScrolling();
        this.startTimer();
    };
    
    TeleprompterDisplay.prototype.pause = function(pausedTime) {
        this.isPlaying = false;
        this.isPaused = true;
        this.pausedTime = pausedTime || 0;
        
        this.stopScrolling();
        this.stopTimer();
    };
    
    TeleprompterDisplay.prototype.reset = function() {
        this.isPlaying = false;
        this.isPaused = false;
        this.currentPosition = 0;
        this.startTime = null;
        this.pausedTime = 0;
        
        this.stopScrolling();
        this.stopTimer();
        
        if (this.prompterText) {
            this.setTransform(this.prompterText, 'translateY(0%)');
        }
        
        this.updateDisplay();
    };
    
    TeleprompterDisplay.prototype.setTransform = function(el, value) {
        if (!el) return;
        
        el.style.transform = value;
        el.style.webkitTransform = value;
        el.style.mozTransform = value;
        el.style.msTransform = value;
        el.style.oTransform = value;
    };
    
    TeleprompterDisplay.prototype.startScrolling = function() {
        var self = this;
        
        // Get animation frame function
        var requestFrame = window.requestAnimationFrame || 
                           window.webkitRequestAnimationFrame || 
                           window.mozRequestAnimationFrame ||
                           window.oRequestAnimationFrame ||
                           function(callback) { return setTimeout(callback, 16); };
        
        var scroll = function() {
            if (!self.isPlaying) return;
            
            var wordsPerSecond = self.speed / 60;
            var pixelsPerSecond = wordsPerSecond * 12;
            var pixelsPerFrame = pixelsPerSecond / 60;
            
            self.currentPosition += pixelsPerFrame;
            
            var viewportHeight = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
            var translateY = -(self.currentPosition / viewportHeight) * 100;
            
            self.setTransform(self.prompterText, 'translateY(' + translateY + '%)');
            
            self.animationId = requestFrame(scroll);
        };
        
        self.animationId = requestFrame(scroll);
    };
    
    TeleprompterDisplay.prototype.stopScrolling = function() {
        if (this.animationId) {
            var cancelFrame = window.cancelAnimationFrame || 
                              window.webkitCancelAnimationFrame || 
                              window.mozCancelAnimationFrame ||
                              window.oCancelAnimationFrame ||
                              clearTimeout;
            
            cancelFrame(this.animationId);
            this.animationId = null;
        }
    };
    
    TeleprompterDisplay.prototype.startTimer = function() {
        var self = this;
        
        self.timerInterval = setInterval(function() {
            self.updateDisplay();
        }, 1000);
    };
    
    TeleprompterDisplay.prototype.stopTimer = function() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    };
    
    TeleprompterDisplay.prototype.updateDisplay = function() {
        var elapsed = this.startTime ? Date.now() - this.startTime : this.pausedTime;
        var remaining = Math.max(0, this.segmentDuration - elapsed);
        
        this.updateCountdownDisplay(remaining);
        this.updateElapsedDisplay(elapsed);
    };
    
    TeleprompterDisplay.prototype.updateCountdownDisplay = function(remaining) {
        if (typeof remaining === 'undefined') {
            remaining = this.segmentDuration;
        }
        
        var minutes = Math.floor(remaining / 60000);
        var seconds = Math.floor((remaining % 60000) / 1000);
        
        if (this.countdownTimer) {
            this.countdownTimer.textContent = padZero(minutes) + ':' + padZero(seconds);
            
            // Update color based on time
            this.countdownTimer.className = '';
            if (remaining < 60000) {
                addClass(this.countdownTimer, 'danger');
            } else if (remaining < 300000) {
                addClass(this.countdownTimer, 'warning');
            }
        }
    };
    
    TeleprompterDisplay.prototype.updateElapsedDisplay = function(elapsed) {
        var minutes = Math.floor(elapsed / 60000);
        var seconds = Math.floor((elapsed % 60000) / 1000);
        
        if (this.elapsedTime) {
            this.elapsedTime.textContent = padZero(minutes) + ':' + padZero(seconds);
        }
    };
    
    TeleprompterDisplay.prototype.updateConnectionStatus = function(status, text) {
        if (this.statusIndicator) {
            this.statusIndicator.className = 'status-indicator ' + status;
        }
        if (this.statusText) {
            this.statusText.textContent = text;
        }
    };
    
    // ========================================
    // Keyboard Shortcuts
    // ========================================
    
    TeleprompterDisplay.prototype.bindKeyboardShortcuts = function() {
        var self = this;
        
        addEventListener(document, 'keydown', function(e) {
            var key = e.key || e.keyCode;
            
            // F11 or F for fullscreen
            if (key === 'F11' || key === 'f' || key === 'F' || key === 122 || key === 70) {
                if (e.preventDefault) e.preventDefault();
                self.toggleFullscreen();
            }
            
            // Escape to exit fullscreen
            if (key === 'Escape' || key === 27) {
                self.exitFullscreen();
            }
        });
        
        // Fullscreen change handlers
        var handleFullscreenChange = function() {
            var isFullscreen = document.fullscreenElement || 
                               document.webkitFullscreenElement || 
                               document.mozFullScreenElement || 
                               document.msFullscreenElement;
            
            if (isFullscreen) {
                addClass(document.body, 'fullscreen');
            } else {
                removeClass(document.body, 'fullscreen');
            }
        };
        
        addEventListener(document, 'fullscreenchange', handleFullscreenChange);
        addEventListener(document, 'webkitfullscreenchange', handleFullscreenChange);
        addEventListener(document, 'mozfullscreenchange', handleFullscreenChange);
        addEventListener(document, 'MSFullscreenChange', handleFullscreenChange);
    };
    
    TeleprompterDisplay.prototype.toggleFullscreen = function() {
        var elem = document.documentElement;
        
        var isFullscreen = document.fullscreenElement || 
                           document.webkitFullscreenElement || 
                           document.mozFullScreenElement || 
                           document.msFullscreenElement;
        
        if (!isFullscreen) {
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            } else if (elem.mozRequestFullScreen) {
                elem.mozRequestFullScreen();
            } else if (elem.msRequestFullscreen) {
                elem.msRequestFullscreen();
            }
        } else {
            this.exitFullscreen();
        }
    };
    
    TeleprompterDisplay.prototype.exitFullscreen = function() {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    };
    
    // ========================================
    // Initialize on DOM Ready
    // ========================================
    
    function domReady(callback) {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(callback, 1);
        } else if (document.addEventListener) {
            document.addEventListener('DOMContentLoaded', callback);
        } else if (document.attachEvent) {
            document.attachEvent('onreadystatechange', function() {
                if (document.readyState === 'complete') {
                    callback();
                }
            });
        } else {
            window.onload = callback;
        }
    }
    
    domReady(function() {
        window.teleprompterDisplay = new TeleprompterDisplay();
    });
    
})(window, document);