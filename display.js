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
        this.connectionType = null;
        this.pollingInterval = null;
        this.pollDelay = 1000;
        this.clientId = this.generateClientId();
        this.lastEventId = 0;
        
        // Paragraph tracking
        this.currentParagraphIndex = 0;
        this.paragraphPositions = [];
        
        this.initializeElements();
        this.connect();
        this.bindKeyboardShortcuts();
        this.setupReconnection();
    }
    
    generateClientId() {
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
            this.connectPolling();
        }
    }
    
    connectPolling() {
        this.connectionType = 'polling';
        this.updateConnectionStatus('connecting', 'Connecting (Polling)...');
        
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
        
        this.poll();
        
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
    
    httpRequest(method, url, data) {
        return new Promise((resolve, reject) => {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 30000;
            
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
            
            xhr.ontimeout = function() {
                reject(new Error('Request timeout'));
            };
            
            if (data) {
                xhr.send(JSON.stringify(data));
            } else {
                xhr.send();
            }
        });
    }
    
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
                this.calculateParagraphPositions();
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
                
            // Scroll control messages
            case 'scrollUp':
                this.scrollUp(data.pixels || 100);
                break;
                
            case 'scrollDown':
                this.scrollDown(data.pixels || 100);
                break;
                
            case 'nextParagraph':
                this.goToNextParagraph();
                break;
                
            case 'prevParagraph':
                this.goToPrevParagraph();
                break;
                
            case 'goToParagraph':
                this.goToParagraphByIndex(data.index || 0);
                break;
                
            case 'setScrollPosition':
                this.setScrollPosition(data.position || 0);
                break;
                
            case 'pong':
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
        this.calculateParagraphPositions();
    }
    
    // ========================================
    // Scroll Control Methods
    // ========================================
    
    scrollUp(pixels) {
        this.currentPosition = Math.max(0, this.currentPosition - pixels);
        this.updateScrollPosition();
    }
    
    scrollDown(pixels) {
        this.currentPosition += pixels;
        this.updateScrollPosition();
    }
    
    setScrollPosition(position) {
        this.currentPosition = Math.max(0, position);
        this.updateScrollPosition();
    }
    
    updateScrollPosition() {
        var translateY = -(this.currentPosition / window.innerHeight) * 100;
        var transform = 'translateY(' + translateY + '%)';
        this.prompterText.style.transform = transform;
        this.prompterText.style.webkitTransform = transform;
    }
    
    calculateParagraphPositions() {
        this.paragraphPositions = [];
        var paragraphs = this.prompterText.querySelectorAll('p');
        var baseOffset = this.prompterText.offsetTop;
        
        for (var i = 0; i < paragraphs.length; i++) {
            this.paragraphPositions.push(paragraphs[i].offsetTop - baseOffset);
        }
    }
    
    goToNextParagraph() {
        if (this.paragraphPositions.length === 0) {
            this.calculateParagraphPositions();
        }
        
        // Find the next paragraph after current position
        for (var i = 0; i < this.paragraphPositions.length; i++) {
            if (this.paragraphPositions[i] > this.currentPosition + 10) {
                this.currentParagraphIndex = i;
                this.currentPosition = this.paragraphPositions[i];
                this.updateScrollPosition();
                return;
            }
        }
    }
    
    goToPrevParagraph() {
        if (this.paragraphPositions.length === 0) {
            this.calculateParagraphPositions();
        }
        
        // Find the previous paragraph before current position
        for (var i = this.paragraphPositions.length - 1; i >= 0; i--) {
            if (this.paragraphPositions[i] < this.currentPosition - 10) {
                this.currentParagraphIndex = i;
                this.currentPosition = this.paragraphPositions[i];
                this.updateScrollPosition();
                return;
            }
        }
        
        // Go to start if no previous paragraph
        this.currentPosition = 0;
        this.currentParagraphIndex = 0;
        this.updateScrollPosition();
    }
    
    goToParagraphByIndex(index) {
        if (this.paragraphPositions.length === 0) {
            this.calculateParagraphPositions();
        }
        
        if (index >= 0 && index < this.paragraphPositions.length) {
            this.currentParagraphIndex = index;
            this.currentPosition = this.paragraphPositions[index];
            this.updateScrollPosition();
        }
    }
    
    // ========================================
    // Display Methods
    // ========================================
    
    setPrompterText(text) {
        if (typeof text === 'string') {
            var paragraphs = text.split('\n\n').filter(function(p) {
                return p.trim().length > 0;
            });
            this.prompterText.innerHTML = paragraphs.map(function(p) {
                return '<p>' + p.trim() + '</p>';
            }).join('');
        } else {
            this.prompterText.innerHTML = text;
        }
        
        // Recalculate paragraph positions after text change
        var self = this;
        setTimeout(function() {
            self.calculateParagraphPositions();
        }, 100);
    }
    
    setMirrorMode(enabled) {
        if (enabled) {
            document.body.classList.add('mirror-mode');
        } else {
            document.body.classList.remove('mirror-mode');
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
            this.onAirIndicator.classList.add('active');
        } else {
            this.onAirIndicator.classList.remove('active');
        }
    }
    
    setScheduledStart(scheduledTime) {
        this.scheduledStartTime = scheduledTime;
        var targetDate = new Date(scheduledTime);
        this.countdownTarget.textContent = 'Starting at: ' + targetDate.toLocaleTimeString();
        
        this.scheduledCountdown.classList.add('active');
        this.startScheduledCountdown();
    }
    
    clearScheduledStart() {
        this.scheduledStartTime = null;
        this.scheduledCountdown.classList.remove('active');
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
        this.currentParagraphIndex = 0;
        
        this.stopScrolling();
        this.stopTimer();
        
        this.prompterText.style.transform = 'translateY(0%)';
        this.prompterText.style.webkitTransform = 'translateY(0%)';
        this.updateDisplay();
    }
    
    startScrolling() {
        var self = this;
        
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
            var transform = 'translateY(' + translateY + '%)';
            self.prompterText.style.transform = transform;
            self.prompterText.style.webkitTransform = transform;
            
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
            this.countdownTimer.classList.add('danger');
        } else if (remaining < 300000) {
            this.countdownTimer.classList.add('warning');
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
        
        document.addEventListener('keydown', function(e) {
            // F11 or F for fullscreen
            if (e.key === 'F11' || e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                self.toggleFullscreen();
            }
            
            // Escape to exit fullscreen
            if (e.key === 'Escape') {
                if (document.fullscreenElement || document.webkitFullscreenElement) {
                    self.exitFullscreen();
                }
            }
            
            // Arrow keys for manual scroll
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                self.scrollUp(100);
            }
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                self.scrollDown(100);
            }
            
            // Page Up/Down for paragraph navigation
            if (e.key === 'PageUp') {
                e.preventDefault();
                self.goToPrevParagraph();
            }
            
            if (e.key === 'PageDown') {
                e.preventDefault();
                self.goToNextParagraph();
            }
            
            // Home to go to start
            if (e.key === 'Home') {
                e.preventDefault();
                self.setScrollPosition(0);
            }
        });
        
        // Handle fullscreen change
        document.addEventListener('fullscreenchange', function() {
            if (document.fullscreenElement) {
                document.body.classList.add('fullscreen');
            } else {
                document.body.classList.remove('fullscreen');
            }
        });
        
        document.addEventListener('webkitfullscreenchange', function() {
            if (document.webkitFullscreenElement) {
                document.body.classList.add('fullscreen');
            } else {
                document.body.classList.remove('fullscreen');
            }
        });
    }
    
    toggleFullscreen() {
        var elem = document.documentElement;
        
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
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
        }
    }
    
    // ========================================
    // Utility Methods
    // ========================================
    
    padZero(num) {
        return (num < 10 ? '0' : '') + num;
    }
}

// Initialize display when page loads
document.addEventListener('DOMContentLoaded', function() {
    new TeleprompterDisplay();
});