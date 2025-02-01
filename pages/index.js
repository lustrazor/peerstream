import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import SimplePeer from 'simple-peer';
import Hls from 'hls.js';
import 'boxicons/css/boxicons.min.css';
import { useTheme } from '../hooks/useTheme';
import { useAudioMeter } from '../hooks/useAudioMeter';

export default function Home() {
  const [message, setMessage] = useState('Peer Stream');
  const [stats, setStats] = useState('Waiting to start...');
  const [roomId, setRoomId] = useState('default-room');
  const [connectionInfo, setConnectionInfo] = useState('');
  const [isStreamer, setIsStreamer] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeStreams, setActiveStreams] = useState([]);
  const [isDark, toggleTheme] = useTheme();
  const [audioPermission, setAudioPermission] = useState('prompt'); // 'prompt', 'granted', 'denied'
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  
  const socketRef = useRef();
  const peersRef = useRef(new Map());
  const streamRef = useRef();
  const videoRef = useRef();
  const { volume: localVolume, isMuted: isLocalMuted, toggleMute: toggleLocalMute, hasAudio: hasLocalAudio, gain: localGain, adjustGain: adjustLocalGain } = 
    useAudioMeter(streamRef.current, isStreamer);
  const { volume: remoteVolume, isMuted: isRemoteMuted, toggleMute: toggleRemoteMute, hasAudio: hasRemoteAudio, gain: remoteGain, adjustGain: adjustRemoteGain } = 
    useAudioMeter(videoRef.current?.srcObject, !isStreamer);

  useEffect(() => {
    socketRef.current = io('/', {
      path: '/api/socket',
    });

    socketRef.current.on('connect', () => {
      setStats(prev => prev + '\nConnected to signaling server');
    });

    socketRef.current.on('user-joined', (userId) => {
      setStats(prev => prev + '\nUser joined: ' + userId);
      if (isStreamer) {
        initiateCall(userId);
      }
    });

    socketRef.current.on('signal', ({ from, signal }) => {
      setStats(prev => prev + '\nReceived signal from: ' + from);
      handleSignal(from, signal);
    });

    socketRef.current.on('disconnect', () => {
      setIsLoading(false);
      setStats(prev => prev + '\nDisconnected from server');
    });

    socketRef.current.on('active-streams', (streams) => {
      setActiveStreams(streams);
      setStats(prev => prev + '\nReceived active streams list');
    });

    socketRef.current.on('stream-started', (roomId) => {
      setActiveStreams(prev => [...prev, roomId]);
      setStats(prev => prev + `\nNew stream started: ${roomId}`);
    });

    socketRef.current.on('stream-ended', (roomId) => {
      setActiveStreams(prev => prev.filter(id => id !== roomId));
      setStats(prev => prev + `\nStream ended: ${roomId}`);
    });

    return () => {
      setIsLoading(false);
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      // Cleanup all peer connections
      for (const [peerId, peer] of peersRef.current.entries()) {
        cleanupPeerConnection(peerId);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [isStreamer]);

  const checkAudioPermissions = async () => {
    try {
      // Check if permissions API is supported
      if (!navigator.permissions || !navigator.permissions.query) {
        return 'prompt';
      }
      
      const result = await navigator.permissions.query({ name: 'microphone' });
      return result.state;
    } catch (error) {
      console.log('Permission check error:', error);
      return 'prompt';
    }
  };

  const requestAudioPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Clean up test stream
      setAudioPermission('granted');
      return true;
    } catch (error) {
      setAudioPermission('denied');
      setStats(prev => prev + '\nAudio permission denied: ' + error.message);
      return false;
    }
  };

  const handleWebRTCStart = async () => {
    try {
      setStats('Initializing WebRTC...');
      if (!isStreamer) {
        setIsLoading(true); // Show loader for viewers
      }
      
      if (isStreamer) {
        // Check permissions before starting stream
        const permissionState = await checkAudioPermissions();
        if (permissionState === 'denied') {
          setStats(prev => prev + '\nMicrophone access denied');
          return;
        }
        if (permissionState === 'prompt') {
          const granted = await requestAudioPermission();
          if (!granted) return;
        }
        
        // Only get media if we're the streamer
        try {
          // First try to get audio stream
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          });

          // Then get video stream
          const videoStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });

          console.log('Got streams:', {
            audioTracks: audioStream.getAudioTracks(),
            videoTracks: videoStream.getVideoTracks()
          });

          // Combine the streams
          const combinedStream = new MediaStream([
            ...audioStream.getAudioTracks(),
            ...videoStream.getVideoTracks()
          ]);

          // Log the combined stream details
          console.log('Combined stream:', {
            audioTracks: combinedStream.getAudioTracks().map(track => ({
              label: track.label,
              enabled: track.enabled,
              muted: track.muted,
              settings: track.getSettings()
            })),
            videoTracks: combinedStream.getVideoTracks().map(track => ({
              label: track.label,
              enabled: track.enabled,
              muted: track.muted,
              settings: track.getSettings()
            }))
          });

          streamRef.current = combinedStream;
          videoRef.current.srcObject = combinedStream;
          setStats(prev => prev + '\nGot local stream with audio and video');
          
          // Notify server about new stream
          socketRef.current.emit('start-stream', roomId);
        } catch (mediaError) {
          console.error('Media error:', mediaError);
          setStats(prev => prev + '\nMedia Error: ' + mediaError.message);
          
          // Fallback to screen sharing
          try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: true // Try to get system audio
            });

            // If screen share succeeded but without audio, try to add microphone audio
            if (screenStream.getAudioTracks().length === 0) {
              try {
                const audioStream = await navigator.mediaDevices.getUserMedia({
                  audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                  },
                  video: false
                });

                screenStream.addTrack(audioStream.getAudioTracks()[0]);
              } catch (audioError) {
                console.warn('Could not add microphone audio to screen share:', audioError);
              }
            }

            streamRef.current = screenStream;
            videoRef.current.srcObject = screenStream;
            setStats(prev => prev + '\nGot screen share stream');

            // Notify server about new stream
            socketRef.current.emit('start-stream', roomId);
          } catch (screenError) {
            console.error('Screen share error:', screenError);
            setStats(prev => prev + '\nScreen share error: ' + screenError.message);
          }
        }
      }
      
      // Join room
      socketRef.current.emit('join-room', roomId);
      setStats(prev => prev + `\nJoined room as ${isStreamer ? 'streamer' : 'viewer'}`);

      const connectionInfo = isStreamer ? `
To view the stream:
1. Open ${window.location.origin} in another browser
2. Select "Viewer" mode
3. Click "Start WebRTC"
4. Use room ID: ${roomId}
      ` : '';
      setConnectionInfo(connectionInfo);

    } catch (error) {
      setIsLoading(false);
      setStats(prev => prev + '\nError: ' + error.message);
    }
  };

  const cleanupPeerConnection = (peerId) => {
    const peer = peersRef.current.get(peerId);
    if (peer) {
      peer.destroy();
      peersRef.current.delete(peerId);
    }
  };

  const initiateCall = (userId) => {
    // Cleanup any existing connection with this peer
    cleanupPeerConnection(userId);

    const iceConfig = {
      iceServers: [
        { 
          urls: [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
            'stun:stun2.l.google.com:19302'
          ]
        },
        {
          // Metered TURN servers
          urls: [
            'turn:a.relay.metered.ca:80',
            'turn:a.relay.metered.ca:80?transport=tcp',
            'turn:a.relay.metered.ca:443',
            'turn:a.relay.metered.ca:443?transport=tcp'
          ],
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    const peer = new SimplePeer({
      initiator: isStreamer,
      stream: streamRef.current,
      trickle: true,
      config: iceConfig,
      sdpTransform: (sdp) => {
        // Force VP8 codec and reasonable bitrates
        return sdp.replace(/a=mid:video\r\n/g, 
          'a=mid:video\r\nb=AS:2000\r\nb=TIAS:2000000\r\n');
      }
    });

    peer.on('signal', (signal) => {
      socketRef.current.emit('signal', {
        to: userId,
        from: socketRef.current.id,
        signal
      });
    });

    peer.on('connect', () => {
      console.log('Peer connection established');
      setStats(prev => prev + '\nPeer connection established');
    });

    peer.on('stream', (stream) => {
      console.log('Received stream:', {
        video: stream.getVideoTracks().map(t => ({
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          constraints: t.getConstraints()
        })),
        audio: stream.getAudioTracks().map(t => ({
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          constraints: t.getConstraints()
        }))
      });
      
      setStats(prev => prev + '\nReceived remote stream from: ' + userId);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => {
          setStats(prev => prev + '\nPlayback error: ' + e.message);
        });
        setIsLoading(false);
      }
    });

    peer.on('iceStateChange', (state) => {
      console.log('ICE state:', state);
      setStats(prev => prev + '\nICE state: ' + state);
      
      if (state === 'disconnected' || state === 'failed') {
        console.log('Attempting to restart ICE');
        peer.restartIce();
      }
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      setStats(prev => prev + '\nPeer error: ' + err.message);
      
      if (err.code === 'ERR_ICE_CONNECTION_FAILURE') {
        console.log('ICE connection failed, attempting restart');
        peer.restartIce();
        
        // Set a timeout for cleanup if restart fails
        setTimeout(() => {
          if (peer.iceConnectionState === 'failed') {
            console.log('ICE restart failed, cleaning up connection');
            cleanupPeerConnection(userId);
          }
        }, 10000);
      }
    });

    peer.on('close', () => {
      setStats(prev => prev + '\nPeer connection closed with: ' + userId);
      setIsLoading(false);
      cleanupPeerConnection(userId);
    });

    // Store the new peer connection
    peersRef.current.set(userId, peer);
  };

  const handleSignal = (userId, signal) => {
    let peer = peersRef.current.get(userId);
    if (!peer) {
      initiateCall(userId);
      peer = peersRef.current.get(userId);
    }
    if (peer) {
      peer.signal(signal);
    }
  };

  const handleFullscreen = () => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.requestFullscreen().catch((err) => {
          setStats(prev => prev + '\nFullscreen error: ' + err.message);
        });
      }
    }
  };

  const toggleTheaterMode = () => {
    setIsTheaterMode(!isTheaterMode);
  };

  // Add timeout for loading state
  useEffect(() => {
    if (isLoading) {
      const timeout = setTimeout(() => {
        setIsLoading(false);
        setStats(prev => prev + '\nConnection timed out. Please try again.');
      }, 15000); // 15 second timeout

      return () => clearTimeout(timeout);
    }
  }, [isLoading]);

  // Add escape key handler
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isTheaterMode) {
        setIsTheaterMode(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isTheaterMode]);

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-200 ${
      isDark 
        ? 'bg-gradient-to-b from-gray-900 to-gray-700 text-white' 
        : 'bg-gradient-to-b from-gray-300 to-white text-gray-900'
    }`}>
      {/* Header */}
      <header className={`p-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <h1 className={`text-2xl font-bold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
            Peer Stream
          </h1>
          <div className="flex gap-4 items-center">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className={`p-2 rounded-lg transition-colors ${
                isDark 
                  ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' 
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
              }`}
            >
              <i className={`bx ${isDark ? 'bx-sun' : 'bx-moon'} text-xl`}></i>
            </button>

            {/* Mode Selection Buttons */}
            <div className={`flex rounded-lg p-1 bg-opacity-50 shadow-inner ${
              isDark ? 'bg-gray-800' : 'bg-gray-100'
            }`}>
              <button
                onClick={() => setIsStreamer(false)}
                className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 ${
                  !isStreamer 
                    ? `${isDark ? 'bg-blue-500' : 'bg-blue-600'} text-white shadow-lg` 
                    : `${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800'}`
                }`}
              >
                <i className='bx bx-video text-lg'></i>
                Viewer
              </button>
              <button
                onClick={() => setIsStreamer(true)}
                className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 ${
                  isStreamer 
                    ? `${isDark ? 'bg-blue-500' : 'bg-blue-600'} text-white shadow-lg` 
                    : `${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800'}`
                }`}
              >
                <i className='bx bx-broadcast text-lg'></i>
                Streamer
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Now with flex-1 to push stats to bottom */}
      <main className="flex-1">
        <div className="max-w-6xl mx-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Stream Controls */}
            <div className="lg:col-span-1">
              {isStreamer ? (
                <div className={`rounded-lg p-6 shadow-lg ${
                  isDark ? 'bg-gray-800' : 'bg-white'
                }`}>
                  <h2 className={`text-xl font-semibold mb-4 ${
                    isDark ? 'text-white' : 'text-gray-900'
                  }`}>Stream Setup</h2>
                  
                  {/* Permission Prompt */}
                  {audioPermission !== 'granted' && (
                    <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                      <div className="flex items-center gap-3 mb-2">
                        <i className='bx bx-microphone text-yellow-500 text-xl'></i>
                        <span className="text-yellow-500 font-medium">Microphone Access Required</span>
                      </div>
                      <p className="text-sm text-gray-400 mb-4">
                        To stream with audio, we need permission to access your microphone.
                      </p>
                      <button
                        onClick={requestAudioPermission}
                        className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium py-2 px-4 rounded-lg
                          transition-colors duration-200 flex items-center gap-2"
                      >
                        <i className='bx bx-lock-open-alt'></i>
                        Allow Microphone Access
                      </button>
                    </div>
                  )}

                  {/* Audio Status Panel */}
                  {audioPermission === 'granted' && (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-300">Audio Source</span>
                        <div className="flex items-center gap-2">
                          {hasLocalAudio ? (
                            <>
                              <span className="text-xs text-green-400">Active</span>
                              <div className="w-2 h-2 rounded-full bg-green-500"></div>
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-red-400">No Audio</span>
                              <div className="w-2 h-2 rounded-full bg-red-500"></div>
                            </>
                          )}
                        </div>
                      </div>
                      
                      {hasLocalAudio && (
                        <>
                          <div className="flex items-center gap-3 mb-2">
                            <button
                              onClick={toggleLocalMute}
                              className="text-white hover:text-blue-400 transition-colors"
                            >
                              <i className={`bx ${isLocalMuted ? 'bx-volume-mute text-red-500' : 'bx-volume-full'} text-xl`}></i>
                            </button>
                            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                              <div 
                                className="h-full transition-all duration-100"
                                style={{ 
                                  width: `${localVolume * 100}%`,
                                  backgroundColor: `hsl(${Math.max(0, 120 - localVolume * 120)}, 100%, 50%)`
                                }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 w-12 text-right">
                              {Math.round(localVolume * 100)}%
                            </span>
                          </div>
                          
                          {localVolume === 0 && !isLocalMuted && (
                            <div className="text-xs text-yellow-400 mt-2 flex items-center gap-1">
                              <i className='bx bx-error'></i>
                              No audio detected. Check your microphone or audio source.
                            </div>
                          )}
                          {isLocalMuted && (
                            <div className="text-xs text-red-400 mt-2 flex items-center gap-1">
                              <i className='bx bx-error'></i>
                              Audio is muted
                            </div>
                          )}
                        </>
                      )}
                      
                      {!hasLocalAudio && (
                        <div className="text-xs text-gray-400 mt-2">
                          Tips:
                          <ul className="list-disc list-inside mt-1 space-y-1">
                            <li>Make sure you've allowed microphone access</li>
                            <li>Check if your audio device is properly connected</li>
                            <li>Try selecting a different audio source</li>
                          </ul>
                        </div>
                      )}

                      {/* Debug Info */}
                      {isStreamer && (
                        <div className="mt-4 p-3 bg-gray-900 rounded text-xs font-mono">
                          <div className="text-gray-400 mb-2">Debug Info:</div>
                          <div className="space-y-1">
                            <div>Audio Permission: <span className="text-blue-400">{audioPermission}</span></div>
                            <div>Has Audio Tracks: <span className="text-blue-400">{hasLocalAudio ? 'Yes' : 'No'}</span></div>
                            <div>Stream Active: <span className="text-blue-400">{streamRef.current?.active ? 'Yes' : 'No'}</span></div>
                            <div>Track Count: <span className="text-blue-400">{streamRef.current?.getTracks().length || 0}</span></div>
                            {streamRef.current?.getAudioTracks().map((track, i) => (
                              <div key={i}>
                                Track {i}: <span className="text-blue-400">{track.label}</span>
                                <div className="pl-4 text-gray-500">
                                  <div>Enabled: {track.enabled ? 'Yes' : 'No'}</div>
                                  <div>Muted: {track.muted ? 'Yes' : 'No'}</div>
                                  <div>State: {track.readyState}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${
                        isDark ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                        Stream Name
                      </label>
                      <input
                        type="text"
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value)}
                        placeholder="Enter a unique stream name"
                        className={`w-full px-4 py-2 rounded-lg border focus:outline-none focus:border-blue-500 ${
                          isDark 
                            ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                            : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                        }`}
                      />
                    </div>
                    <button 
                      onClick={handleWebRTCStart}
                      disabled={audioPermission === 'denied'}
                      className={`w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 
                        rounded-lg transition-colors duration-200 ${
                          audioPermission === 'denied' ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                    >
                      {audioPermission === 'denied' 
                        ? 'Microphone Access Required' 
                        : 'Start Streaming'
                      }
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`rounded-lg p-6 shadow-lg ${
                  isDark ? 'bg-gray-800' : 'bg-white'
                }`}>
                  <h2 className={`text-xl font-semibold mb-4 ${
                    isDark ? 'text-white' : 'text-gray-900'
                  }`}>Available Streams</h2>
                  {activeStreams.length > 0 ? (
                    <div className="space-y-2">
                      {activeStreams.map((streamId) => (
                        <button
                          key={streamId}
                          onClick={() => setRoomId(streamId)}
                          className={`w-full p-3 rounded-lg transition-colors duration-200 text-left
                            ${roomId === streamId 
                              ? 'bg-slate-500 text-white' 
                              : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
                        >
                          <span className="flex items-center">
                            <i className='bx bx-broadcast mr-2'></i>
                            {streamId}
                          </span>
                        </button>
                      ))}
                      <button 
                        onClick={handleWebRTCStart}
                        disabled={!roomId}
                        className={`w-full mt-4 py-2 px-4 rounded-lg font-semibold
                          ${roomId 
                            ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                            : 'bg-gray-700 text-gray-400 cursor-not-allowed'}`}
                      >
                        Join Stream
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-400">
                      <i className='bx bx-video-off text-4xl mb-2'></i>
                      <p>No active streams</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Column - Video Display */}
            <div className={`${
              isTheaterMode 
                ? 'fixed inset-0 z-50 bg-black' 
                : 'lg:col-span-2'
            }`}>
              <div className={`${
                isTheaterMode 
                  ? 'h-full' 
                  : 'rounded-lg shadow-lg overflow-hidden'
              } ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
                {/* Video Container */}
                <div className={`relative group ${
                  isTheaterMode 
                    ? 'h-full' 
                    : 'aspect-video'
                } bg-black`}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className={`w-full h-full object-contain ${isLoading ? 'hidden' : ''}`}
                  />
                  
                  {/* Audio Controls */}
                  {!isLoading && ((isStreamer && hasLocalAudio) || (!isStreamer && hasRemoteAudio)) && (
                    <div className="absolute bottom-4 w-full px-4 flex items-center justify-between
                      opacity-0 group-hover:opacity-100 transition-all duration-200">
                      <div className="flex items-center gap-4 bg-black/50 p-2 rounded-lg">
                        <button
                          onClick={isStreamer ? toggleLocalMute : toggleRemoteMute}
                          className="text-white hover:text-blue-400 transition-colors"
                        >
                          <i className={`bx ${
                            (isStreamer ? isLocalMuted : isRemoteMuted) 
                              ? 'bx-volume-mute text-red-500' 
                              : 'bx-volume-full'
                          } text-2xl`}></i>
                        </button>
                        
                        {/* Gain Control */}
                        <div className="flex items-center gap-2">
                          <i className='bx bx-volume-low text-gray-400'></i>
                          <input
                            type="range"
                            min="0"
                            max="5"
                            step="0.1"
                            value={isStreamer ? localGain : remoteGain}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value);
                              if (isStreamer) {
                                adjustLocalGain(value);
                              } else {
                                adjustRemoteGain(value);
                              }
                            }}
                            className="w-20 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer
                              [&::-webkit-slider-thumb]:appearance-none
                              [&::-webkit-slider-thumb]:w-3
                              [&::-webkit-slider-thumb]:h-3
                              [&::-webkit-slider-thumb]:rounded-full
                              [&::-webkit-slider-thumb]:bg-white"
                          />
                          <i className='bx bx-volume-full text-gray-400'></i>
                        </div>
                        
                        {/* Volume Meter */}
                        <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div 
                            className="h-full transition-all duration-100"
                            style={{ 
                              width: `${(isStreamer ? localVolume : remoteVolume) * 100}%`,
                              backgroundColor: `hsl(${
                                Math.max(0, 120 - (isStreamer ? localVolume : remoteVolume) * 120)
                              }, 100%, 50%)`
                            }}
                          />
                        </div>
                        
                        {/* Gain Value Display */}
                        <span className="text-xs text-gray-400 min-w-[3ch]">
                          {((isStreamer ? localGain : remoteGain) * 100).toFixed(0)}%
                        </span>
                      </div>

                      {/* Right controls (theater/fullscreen) */}
                      <div className="flex items-center gap-2 bg-black/50 p-2 rounded-lg">
                        <button
                          onClick={toggleTheaterMode}
                          className="text-white hover:text-blue-400 transition-colors p-1"
                          title={isTheaterMode ? "Exit Theater Mode" : "Theater Mode"}
                        >
                          <i className={`bx ${isTheaterMode ? 'bx-exit' : 'bx-rectangle'} text-2xl`}></i>
                        </button>
                        <button
                          onClick={handleFullscreen}
                          className="text-white hover:text-blue-400 transition-colors p-1"
                          title="Full Screen"
                        >
                          <i className='bx bx-fullscreen text-2xl'></i>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Loading Spinner */}
                  {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                      <div className="text-center">
                        <i className='bx bx-loader-alt bx-spin text-6xl text-blue-500'></i>
                        <p className="mt-4 text-gray-300">Connecting to stream...</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Show connection info below video only when not in theater mode */}
              {connectionInfo && !isTheaterMode && (
                <div className={`mt-4 rounded-lg p-6 shadow-lg ${
                  isDark ? 'bg-gray-800' : 'bg-white'
                }`}>
                  <h3 className="text-lg font-semibold mb-2 flex items-center">
                    <i className='bx bx-info-circle mr-2'></i>
                    Connection Info
                  </h3>
                  <pre className={`text-sm font-mono whitespace-pre-wrap break-words ${
                    isDark ? 'text-green-400' : 'text-green-600'
                  }`}>
                    {connectionInfo}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Stats Panel - Now at the bottom */}
      <div className={`border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="max-w-6xl mx-auto p-4">
          <div className={`rounded-lg shadow-lg ${
            isDark ? 'bg-gray-800' : 'bg-white'
          }`}>
            <div className="flex items-center justify-between p-2 px-4 border-b ${
              isDark ? 'border-gray-700' : 'border-gray-200'
            }">
              <div className="flex items-center gap-2">
                <i className='bx bx-terminal text-xl'></i>
                <h2 className="font-mono font-semibold">Stats</h2>
              </div>
            </div>
            <pre className={`text-sm font-mono whitespace-pre-wrap break-words p-4 overflow-y-auto
              max-h-[200px] ${
              isDark 
                ? 'bg-gray-900 text-teal-400' 
                : 'bg-neutral-800 text-amber-400'
            }`}>
              {stats}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
} 