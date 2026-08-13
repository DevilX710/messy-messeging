# Messy Messenger

A mobile-friendly PWA messenger using HTML/CSS/JS + Supabase.

## Setup

1. Create a Supabase project.
2. Open `supabase.sql` in Supabase SQL Editor and run it.
3. Create a Storage bucket called `chat-media` and make it public for this starter.
4. Enable Realtime for `messages`, `profiles`, and `reactions`.
5. Put your Supabase URL and anon key in `config.js`.
6. Deploy the folder to Netlify, Cloudflare Pages, or another HTTPS host.
7. On iPhone Safari, open the site → Share → Add to Home Screen.

## Important
Microphone access and PWA service workers need HTTPS (localhost also works during development).
Do not put a Supabase service-role key in `config.js`; only use the public anon key.
