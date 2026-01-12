class TeleprompterDisplay {
    constructor() {
        this.connection = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.currentPosition = 0;
        this.startTime = null;
        this.pausedTime = 0;
        this.segmentDuration = 10 * 60 * 1000;
        this.speed = 150;
        this.fontSize = 48;
        this.animationId = null;
        this.timerInterval = null;
        this.scheduledStartTime = null;
        this.scheduledCountdownInterval = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        
        // Connection type tracking
        this.connectionType = null; // 'websocket' or 'polling'
        this.pollingInterval = null;
        this.pollDelay = 1000; // Poll every 1 second
        this.clientId = this.generateClientId();
        this.lastEventId = 0;
        
        this.initializeElements();
        this.connect();
        this.bindKeyboardShortcuts();
        
        // Auto-reconnect on connection loss
        this.setupReconnection();
    }
    
    generateClientId() {
        // Generate a unique client ID for polling sessions
        return 'display_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }
    
    initializeElements() {
        this.prompterText = document.getElementById('prompter-text');
        this.countdownTimer = document.getElementById('countdown-timer');
        this.elapsedTime = document.getElementById('elapsed-time');
        this.connectionStatus = document.getElementById('connection-status');
        this.statusIndicator = this.connectionStatus.querySelector('.status-indicator');
        this.statusText = this.connectionStatus.querySelector('.status-text');
        this.onAirIndicator = document.getElementById('on-air-indicator');
        this.scheduledCountdown = document.getElementById('scheduled-countdown');
        this.countdownTime = document.getElementById('countdown-time');
        this.countdownTarget = document.getElementById('countdown-target');
    }
    
    // ========================================
    // Connection Management
    // ========================================
    
    connect() {
        // Check if WebSocket is supported
        if (this.supportsWebSocket()) {
            this.connectWebSocket();
        } else {
            console.log('WebSocket not supported, falling back to long polling');
            this.connectPolling();
        }
    }
    
    supportsWebSocket() {
        try {
            return 'WebSocket' in window && window.WebSocket !== undefined;
        } catch (e) {
            return false;
        }
    }
    
    // ========================================
    // WebSocket Connection
    // ========================================
    
    connectWebSocket() {
        try {
            this.updateConnectionStatus('connecting', 'Connecting (WebSocket)...');
            this.connectionType = 'websocket';
            
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsPort = window.location.port || (window.location.protocol === 'https:' ? 443 : 80);
            const wsUrl = `${wsProtocol}//${window.location.hostname}:${wsPort}`;
            
            this.connection = new WebSocket(wsUrl);
            
            this.connection.onopen = () => {
                console.log('Connected via WebSocket');
                this.updateConnectionStatus('connected', 'Connected (WS)');
                this.reconnectAttempts = 0;
                
                this.connection.send(JSON.stringify({
                    type: 'register',
                    role: 'display',
                    clientId: this.clientId
                }));
            };
            
            this.connection.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            };
            
            this.connection.onclose = () => {
                console.log('WebSocket connection closed');
                this.updateConnectionStatus('disconnected', 'Disconnected');
                this.scheduleReconnect();
            };
            
            this.connection.onerror = (error) => {
                console.error('WebSocket error:', error);
                // On WebSocket error, try falling back to polling
                if (this.reconnectAttempts >= 2) {
                    console.log('Multiple WebSocket failures, trying polling fallback');
                    this.connectionType = null;
                    this.connectPolling();
                    return;
                }
                this.updateConnectionStatus('disconnected', 'Connection Error');
            };
            
        } catch (error) {
            console.error('Failed to connect via WebSocket:', error);
            this.updateConnectionStatus('disconnected', 'WebSocket Failed');
            // Fall back to polling
            this.connectPolling();
        }
    }
    
    // ========================================
    // Long Polling Connection (Fallback)
    // ========================================
    
    connectPolling() {
        this.connectionType = 'polling';
        this.updateConnectionStatus('connecting', 'Connecting (Polling)...');
        
        // Register with server via HTTP
        this.registerPolling()
            .then(() => {
                this.updateConnectionStatus('connected', 'Connected (Poll)');
                this.reconnectAttempts = 0;
                this.startPolling();
            })
            .catch((error) => {
                console.error('Polling registration failed:', error);
                this.updateConnectionStatus('disconnected', 'Connection Failed');
                this.scheduleReconnect();
            });
    }
    
    registerPolling() {
        return this.httpRequest('POST', '/api/register', {
            role: 'display',
            clientId: this.clientId
        });
    }
    
    startPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }
        
        // Initial poll
        this.poll();
        
        // Continue polling at regular intervals
        this.pollingInterval = setInterval(() => {
            this.poll();
        }, this.pollDelay);
    }
    
    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }
    
    poll() {
        this.httpRequest('GET', '/api/poll?clientId=' + encodeURIComponent(this.clientId) + 
                        '&lastEventId=' + this.lastEventId)
            .then((response) => {
                if (response && response.events && response.events.length > 0) {
                    response.events.forEach((event) => {
                        this.handleMessage(event.data);
                        if (event.id > this.lastEventId) {
                            this.lastEventId = event.id;
                        }
                    });
                }
            })
            .catch((error) => {
                console.error('Polling error:', error);
                this.updateConnectionStatus('disconnected', 'Poll Failed');
                this.stopPolling();
                this.scheduleReconnect();
            });
    }
    
    // ========================================
    // HTTP Request Helper (for polling)
    // ========================================
    
    httpRequest(method, url, data) {
        return new Promise((resolve, reject) => {
            var xhr;
            
            // Support for older browsers
            if (window.XMLHttpRequest) {
                xhr = new XMLHttpRequest();
            } else if (window.ActiveXObject) {
                // IE6 and older
                try {
                    xhr = new ActiveXObject('Msxml2.XMLHTTP');
                } catch (e) {
                    try {
                        xhr = new ActiveXObject('Microsoft.XMLHTTP');
                    } catch (e2) {
                        reject(new Error('XMLHttpRequest not supported'));
                        return;
                    }
                }
            } else {
                reject(new Error('XMLHttpRequest not supported'));
                return;
            }
            
            xhr.open(method, url, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            
            // Timeout for old devices
            if (typeof xhr.timeout !== 'undefined') {
                xhr.timeout = 30000; // 30 second timeout
            }
            
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            var response = xhr.responseText ? JSON.parse(xhr.responseText) : {};
                            resolve(response);
                        } catch (e) {
                            resolve({});
                        }
                    } else {
                        reject(new Error('HTTP ' + xhr.status));
                    }
                }
            };
            
            xhr.onerror = function() {
                reject(new Error('Network error'));
            };
            
            if (typeof xhr.ontimeout !== 'undefined') {
                xhr.ontimeout = function() {
                    reject(new Error('Request timeout'));
                };
            }
            
            if (data) {
                xhr.send(JSON.stringify(data));
            } else {
                xhr.send();
            }
        });
    }
    
    // ========================================
    // Reconnection Logic
    // ========================================
    
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            var delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            this.updateConnectionStatus('connecting', 'Reconnecting in ' + Math.ceil(delay / 1000) + 's...');
            
            var self = this;
            setTimeout(function() {
                self.connect();
            }, delay);
        } else {
            this.updateConnectionStatus('disconnected', 'Max reconnect attempts reached');
        }
    }
    
    setupReconnection() {
        var self = this;
        
        // Try to reconnect when the page becomes visible again
        if (document.addEventListener) {
            document.addEventListener('visibilitychange', function() {
                if (!document.hidden) {
                    var needsReconnect = false;
                    
                    if (self.connectionType === 'websocket') {
                        needsReconnect = !self.connection || self.connection.readyState !== WebSocket.OPEN;
                    } else if (self.connectionType === 'polling') {
                        needsReconnect = !self.pollingInterval;
                    } else {
                        needsReconnect = true;
                    }
                    
                    if (needsReconnect) {
                        self.reconnectAttempts = 0;
                        self.connect();
                    }
                }
            });
        }
    }
    
    // ========================================
    // Send Messages (works with both connections)
    // ========================================
    
    send(data) {
        if (this.connectionType === 'websocket' && this.connection && 
            this.connection.readyState === WebSocket.OPEN) {
            this.connection.send(JSON.stringify(data));
        } else if (this.connectionType === 'polling') {
            // Send via HTTP POST for polling mode
            this.httpRequest('POST', '/api/send', {
                clientId: this.clientId,
                message: data
            }).catch(function(error) {
                console.error('Failed to send message:', error);
            });
        }
    }
    
    // ========================================
    // Message Handling
    // ========================================
    
    handleMessage(data) {
        switch (data.type) {
            case 'stateSync':
                this.syncState(data.state);
                break;
                
            case 'setText':
                this.setPrompterText(data.content);
                break;
                
            case 'setSpeed':
                this.speed = data.value;
                break;
                
            case 'setFontSize':
                this.fontSize = data.value;
                this.prompterText.style.fontSize = this.fontSize + 'px';
                break;
                
            case 'setSegmentLength':
                this.segmentDuration = (data.totalSeconds || data.value || 600) * 1000;
                this.updateCountdownDisplay();
                break;
                
            case 'setMirrorMode':
                this.setMirrorMode(data.enabled);
                break;
                
            case 'setHideTimer':
                this.setHideTimer(data.enabled);
                break;
                
            case 'setOnAir':
                this.setOnAir(data.enabled);
                break;
                
            case 'setScheduledStart':
                this.setScheduledStart(data.scheduledTime);
                break;
                
            case 'clearScheduledStart':
                this.clearScheduledStart();
                break;
                
            case 'start':
                this.start(data.startTime, data.pausedTime);
                break;
                
            case 'pause':
                this.pause(data.pausedTime);
                break;
                
            case 'reset':
                this.reset();
                break;
                
            case 'pong':
                // Heartbeat response
                break;
                
            default:
                console.log('Unknown message type:', data.type);
        }
    }
    
    syncState(state) {
        console.log('Syncing state:', state);
        
        if (state.text) {
            this.setPrompterText(state.text);
        }
        
        this.speed = state.speed;
        this.fontSize = state.fontSize;
        this.segmentDuration = (state.segmentLength || 600) * 1000;
        
        this.prompterText.style.fontSize = this.fontSize + 'px';
        this.setMirrorMode(state.mirrorMode);
        this.setHideTimer(state.hideTimer);
        this.setOnAir(state.onAir);
        
        if (state.scheduledStartTime) {
            this.setScheduledStart(state.scheduledStartTime);
        } else {
            this.clearScheduledStart();
        }
        
        if (state.isPlaying) {
            this.start(state.startTime, state.pausedTime);
        } else if (state.isPaused) {
            this.pause(state.pausedTime);
        } else {
            this.reset();
        }
        
        this.updateCountdownDisplay();
    }
    
    // ========================================
    // Display Methods
    // ========================================
    
    setPrompterText(text) {
        if (typeof text === 'string') {
            var paragraphs = text.split('\n\n');
            var filtered = [];
            for (var i = 0; i < paragraphs.length; i++) {
                var trimmed = paragraphs[i].replace(/^\s+|\s+$/g, '');
                if (trimmed.length > 0) {
                    filtered.push(trimmed);
                }
            }
            var html = '';
            for (var j = 0; j < filtered.length; j++) {
                html += '<p>' + filtered[j] + '</p>';
            }
            this.prompterText.innerHTML = html;
        } else {
            this.prompterText.innerHTML = text;
        }
    }
    
    setMirrorMode(enabled) {
        if (enabled) {
            this.addClass(document.body, 'mirror-mode');
        } else {
            this.removeClass(document.body, 'mirror-mode');
        }
    }
    
    setHideTimer(enabled) {
        var timerDisplay = document.querySelector('.timer-display');
        if (timerDisplay) {
            timerDisplay.style.display = enabled ? 'none' : 'flex';
        }
    }
    
    setOnAir(enabled) {
        if (enabled) {
            this.addClass(this.onAirIndicator, 'active');
        } else {
            this.removeClass(this.onAirIndicator, 'active');
        }
    }
    
    setScheduledStart(scheduledTime) {
        this.scheduledStartTime = scheduledTime;
        var targetDate = new Date(scheduledTime);
        this.countdownTarget.textContent = 'Starting at: ' + targetDate.toLocaleTimeString();
        
        this.addClass(this.scheduledCountdown, 'active');
        this.startScheduledCountdown();
    }
    
    clearScheduledStart() {
        this.scheduledStartTime = null;
        this.removeClass(this.scheduledCountdown, 'active');
        this.stopScheduledCountdown();
    }
    
    startScheduledCountdown() {
        this.stopScheduledCountdown();
        
        var self = this;
        this.scheduledCountdownInterval = setInterval(function() {
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
            
            self.countdownTime.textContent = 
                self.padZero(hours) + ':' + self.padZero(minutes) + ':' + self.padZero(seconds);
        }, 1000);
    }
    
    stopScheduledCountdown() {
        if (this.scheduledCountdownInterval) {
            clearInterval(this.scheduledCountdownInterval);
            this.scheduledCountdownInterval = null;
        }
    }
    
    autoStart() {
        this.start(Date.now(), 0);
    }
    
    // ========================================
    // Playback Control
    // ========================================
    
    start(startTime, pausedTime) {
        this.isPlaying = true;
        this.isPaused = false;
        this.startTime = startTime || Date.now();
        this.pausedTime = pausedTime || 0;
        
        this.startScrolling();
        this.startTimer();
    }
    
    pause(pausedTime) {
        this.isPlaying = false;
        this.isPaused = true;
        this.pausedTime = pausedTime || 0;
        
        this.stopScrolling();
        this.stopTimer();
    }
    
    reset() {
        this.isPlaying = false;
        this.isPaused = false;
        this.currentPosition = 0;
        this.startTime = null;
        this.pausedTime = 0;
        
        this.stopScrolling();
        this.stopTimer();
        
        this.prompterText.style.transform = 'translateY(0%)';
        this.updateDisplay();
    }
    
    startScrolling() {
        var self = this;
        
        // Use requestAnimationFrame if available, otherwise fall back to setTimeout
        var animate = window.requestAnimationFrame || 
                      window.webkitRequestAnimationFrame || 
                      window.mozRequestAnimationFrame ||
                      function(callback) { return setTimeout(callback, 16); };
        
        var scroll = function() {
            if (!self.isPlaying) return;
            
            var wordsPerSecond = self.speed / 60;
            var pixelsPerSecond = wordsPerSecond * 12;
            var pixelsPerFrame = pixelsPerSecond / 60;
            
            self.currentPosition += pixelsPerFrame;
            
            var translateY = -(self.currentPosition / window.innerHeight) * 100;
            
            // Use vendor-prefixed transforms for older browsers
            var transform = 'translateY(' + translateY + '%)';
            self.prompterText.style.transform = transform;
            self.prompterText.style.webkitTransform = transform;
            self.prompterText.style.mozTransform = transform;
            self.prompterText.style.msTransform = transform;
            self.prompterText.style.oTransform = transform;
            
            self.animationId = animate(scroll);
        };
        
        self.animationId = animate(scroll);
    }
    
    stopScrolling() {
        if (this.animationId) {
            var cancel = window.cancelAnimationFrame || 
                         window.webkitCancelAnimationFrame || 
                         window.mozCancelAnimationFrame ||
                         clearTimeout;
            cancel(this.animationId);
            this.animationId = null;
        }
    }
    
    startTimer() {
        var self = this;
        this.timerInterval = setInterval(function() {
            self.updateDisplay();
        }, 1000);
    }
    
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
    
    updateDisplay() {
        var elapsed = this.startTime ? Date.now() - this.startTime : this.pausedTime;
        var remaining = Math.max(0, this.segmentDuration - elapsed);
        
        this.updateCountdownDisplay(remaining);
        this.updateElapsedDisplay(elapsed);
    }
    
    updateCountdownDisplay(remaining) {
        if (typeof remaining === 'undefined') {
            remaining = this.segmentDuration;
        }
        
        var minutes = Math.floor(remaining / 60000);
        var seconds = Math.floor((remaining % 60000) / 1000);
        
        this.countdownTimer.textContent = this.padZero(minutes) + ':' + this.padZero(seconds);
        
        this.countdownTimer.className = '';
        if (remaining < 60000) {
            this.addClass(this.countdownTimer, 'danger');
        } else if (remaining < 300000) {
            this.addClass(this.countdownTimer, 'warning');
        }
    }
    
    updateElapsedDisplay(elapsed) {
        var minutes = Math.floor(elapsed / 60000);
        var seconds = Math.floor((elapsed % 60000) / 1000);
        
        this.elapsedTime.textContent = this.padZero(minutes) + ':' + this.padZero(seconds);
    }
    
    updateConnectionStatus(status, text) {
        this.statusIndicator.className = 'status-indicator ' + status;
        this.statusText.textContent = text;
    }
    
    // ========================================
    // Keyboard Shortcuts
    // ========================================
    
    bindKeyboardShortcuts() {
        var self = this;
        
        var keyHandler = function(e) {
            if (e.key === 'F11' || e.key === 'f' || e.key === 'F' ||
                e.keyCode === 122 || e.keyCode === 70) {
                if (e.preventDefault) e.preventDefault();
                self.toggleFullscreen();
            }
            
            if (e.key === 'Escape' || e.keyCode === 27) {
                if (document.fullscreenElement || document.webkitFullscreenElement || 
                    document.mozFullScreenElement || document.msFullscreenElement) {
                    self.exitFullscreen();
                }
            }
        };
        
        if (document.addEventListener) {
            document.addEventListener('keydown', keyHandler);
        } else if (document.attachEvent) {
            document.attachEvent('onkeydown', keyHandler);
        }
        
        // Handle fullscreen change
        var fullscreenHandler = function() {
            if (document.fullscreenElement || document.webkitFullscreenElement || 
                document.mozFullScreenElement || document.msFullscreenElement) {
                self.addClass(document.body, 'fullscreen');
            } else {
                self.removeClass(document.body, 'fullscreen');
            }
        };
        
        if (document.addEventListener) {
            document.addEventListener('fullscreenchange', fullscreenHandler);
            document.addEventListener('webkitfullscreenchange', fullscreenHandler);
            document.addEventListener('mozfullscreenchange', fullscreenHandler);
            document.addEventListener('MSFullscreenChange', fullscreenHandler);
        }
    }
    
    toggleFullscreen() {
        var elem = document.documentElement;
        
        if (!document.fullscreenElement && !document.webkitFullscreenElement && 
            !document.mozFullScreenElement && !document.msFullscreenElement) {
            
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
    }
    
    exitFullscreen() {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
    
    // ========================================
    // Utility Methods (for older browser support)
    // ========================================
    
    padZero(num) {
        return (num < 10 ? '0' : '') + num;
    }
    
    addClass(element, className) {
        if (!element) return;
        if (element.classList) {
            element.classList.add(className);
        } else {
            var classes = element.className.split(' ');
            if (classes.indexOf(className) === -1) {
                element.className += ' ' + className;
            }
        }
    }
    
    removeClass(element, className) {
        if (!element) return;
        if (element.classList) {
            element.classList.remove(className);
        } else {
            var classes = element.className.split(' ');
            var newClasses = [];
            for (var i = 0; i < classes.length; i++) {
                if (classes[i] !== className) {
                    newClasses.push(classes[i]);
                }
            }
            element.className = newClasses.join(' ');
        }
    }
}

// Initialize display when page loads
if (document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function() {
        new TeleprompterDisplay();
    });
} else if (document.attachEvent) {
    document.attachEvent('onreadystatechange', function() {
        if (document.readyState === 'complete') {
            new TeleprompterDisplay();
        }
    });
} else {
    window.onload = function() {
        new TeleprompterDisplay();
    };
}