import { useRef, useState } from "react";

export function usePlayer() {
    const [isPlaying, setIsPlaying] = useState(false);
    const audioContext = useRef<AudioContext | null>(null);
    const source = useRef<AudioBufferSourceNode | null>(null);

    async function play(stream: ReadableStream, callback: () => void) {
        stop();
        audioContext.current = new AudioContext({ sampleRate: 24000 });

        let nextStartTime = audioContext.current.currentTime;
        const reader = stream.getReader();
        let leftover = new Uint8Array();
        let result = await reader.read();
        setIsPlaying(true);

        while (!result.done && audioContext.current) {
            const incomingData = result.value;

            // Concatenate leftover data with the new data
            const data = new Uint8Array(leftover.length + incomingData.length);
            data.set(leftover);
            data.set(incomingData, leftover.length);

            const sampleSize = 2; // 16-bit PCM (2 bytes per sample)
            const length = Math.floor(data.length / sampleSize) * sampleSize;
            const remainder = data.length % sampleSize;

            // Handle leftover bytes
            leftover = data.slice(length, length + remainder);

            // Convert the Uint8Array to a Float32Array (assumes incoming data is 16-bit PCM)
            const floatBuffer = new Float32Array(length / sampleSize);
            for (let i = 0; i < floatBuffer.length; i++) {
                // Interpret each pair of bytes as a 16-bit signed integer, then normalize to [-1, 1]
                const intSample =
                    (data[i * sampleSize + 1] << 8) | data[i * sampleSize];
                floatBuffer[i] =
                    intSample > 32767 ? (intSample - 65536) / 32768 : intSample / 32768;
            }

            const audioBuffer = audioContext.current.createBuffer(
                1,
                floatBuffer.length,
                audioContext.current.sampleRate
            );
            audioBuffer.copyToChannel(floatBuffer, 0);

            source.current = audioContext.current.createBufferSource();
            source.current.buffer = audioBuffer;
            source.current.connect(audioContext.current.destination);
            source.current.start(nextStartTime);

            nextStartTime += audioBuffer.duration;

            result = await reader.read();
        }

        if (result.done && source.current) {
            source.current.onended = () => {
                stop();
                callback();
            };
        }
    }

    function stop() {
        if (audioContext.current) {
            audioContext.current.close();
            audioContext.current = null;
        }
        if (source.current) {
            source.current.disconnect();
            source.current = null;
        }
        setIsPlaying(false);
    }

    return {
        isPlaying,
        play,
        stop,
    };
}
