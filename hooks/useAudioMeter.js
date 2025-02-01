import { useState, useEffect, useRef } from 'react';

export function useAudioMeter(stream, enabled = true) {
  const [volume, setVolume] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [gain, setGain] = useState(1);
  const [hasAudio, setHasAudio] = useState(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const gainNodeRef = useRef(null);
  const animationFrameRef = useRef(null);

  const adjustGain = (value) => {
    setGain(value);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = value;
    }
  };

  useEffect(() => {
    if (!stream || !enabled) {
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) {
      setHasAudio(false);
      return;
    }

    setHasAudio(true);

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const gainNode = audioContext.createGain();
      gainNode.gain.value = gain;

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      gainNodeRef.current = gainNode;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(gainNode);
      gainNode.connect(analyser);
      
      if (!enabled) {
        gainNode.connect(audioContext.destination);
      }

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const normalizedVolume = average / 255;
        setVolume(normalizedVolume);
        animationFrameRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioContext.state !== 'closed') {
          audioContext.close();
        }
      };
    } catch (error) {
      console.error('Error setting up audio meter:', error);
      setHasAudio(false);
    }
  }, [stream, enabled, gain]);

  const toggleMute = () => {
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks.forEach(track => {
          track.enabled = !track.enabled;
        });
        setIsMuted(!isMuted);
      }
    }
  };

  return { 
    volume, 
    isMuted, 
    toggleMute,
    hasAudio,
    gain,
    adjustGain
  };
} 