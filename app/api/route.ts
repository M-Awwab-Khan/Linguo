import Groq from "groq-sdk";
import { headers } from "next/headers";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { unstable_after as after } from "next/server";
import { createClient } from "@deepgram/sdk";

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const groq = new Groq();

const schema = zfd.formData({
    input: z.union([zfd.text(), zfd.file()]),
    message: zfd.repeatableOfType(
        zfd.json(
            z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
            })
        )
    ),
});

export async function POST(request: Request) {
    console.time("transcribe " + request.headers.get("x-vercel-id") || "local");

    const { data, success } = schema.safeParse(await request.formData());
    if (!success) return new Response("Invalid request", { status: 400 });

    const transcript = await getTranscript(data.input);
    if (!transcript) return new Response("Invalid audio", { status: 400 });

    console.timeEnd(
        "transcribe " + request.headers.get("x-vercel-id") || "local"
    );
    console.time(
        "text completion " + request.headers.get("x-vercel-id") || "local"
    );

    const completion = await groq.chat.completions.create({
        model: "llama3-8b-8192",
        messages: [
            {
                role: "system",
                content: `You are Linguo, an encouraging and knowledgeable language teacher.
                Provide short and clear responses, focusing on language learning and practice.
                If a request is unclear, ask for clarification related to the language topic.
                You do not have access to real-time information, so focus on language instruction rather than providing current events or data.
                Your responses should be suitable for text-to-speech software, avoiding complex formatting, markdown, or emojis.
                Language instruction should be accessible, offering simple explanations or practice exercises.
                You are powered by the Llama 3 language model, an 8-billion parameter version created by Meta, hosted on Groq’s AI infrastructure.
                Your text-to-speech model is Sonic, developed by Cartesia for natural and fast speech synthesis.
                You are implemented using Next.js and hosted on Vercel.
                You dont have to give long explanations of any query, just give an answer in 2 or 3 sentences.`,
            },
            ...data.message,
            {
                role: "user",
                content: transcript,
            },
        ],
    });

    const response = completion.choices[0].message.content;
    console.timeEnd(
        "text completion " + request.headers.get("x-vercel-id") || "local"
    );

    console.time(
        "cartesia request " + request.headers.get("x-vercel-id") || "local"
    );



    const audio = await deepgram.speak.request(
        { text: response },
        {
            model: "aura-asteria-en",
            encoding: "linear16",
            container: "wav",
        }
    );
    // STEP 3: Get the audio stream and headers from the response
    const stream = await audio.getStream();

    console.timeEnd(
        "cartesia request " + request.headers.get("x-vercel-id") || "local"
    );

    // if (!) {
    //     console.error(await voice.text());
    //     return new Response("Voice synthesis failed", { status: 500 });
    // }

    console.time("stream " + request.headers.get("x-vercel-id") || "local");
    after(() => {
        console.timeEnd(
            "stream " + request.headers.get("x-vercel-id") || "local"
        );
    });

    return new Response(stream, {
        headers: {
            "X-Transcript": encodeURIComponent(transcript),
            "X-Response": encodeURIComponent(response),
        },
    });
}

function location() {
    const headersList = headers();

    const country = headersList.get("x-vercel-ip-country");
    const region = headersList.get("x-vercel-ip-country-region");
    const city = headersList.get("x-vercel-ip-city");

    if (!country || !region || !city) return "unknown";

    return `${city}, ${region}, ${country}`;
}

function time() {
    return new Date().toLocaleString("en-US", {
        timeZone: headers().get("x-vercel-ip-timezone") || undefined,
    });
}

async function getTranscript(input: string | File) {
    if (typeof input === "string") return input;

    try {
        const { text } = await groq.audio.transcriptions.create({
            file: input,
            model: "whisper-large-v3",
        });

        return text.trim() || null;
    } catch {
        return null; // Empty audio file
    }
}
