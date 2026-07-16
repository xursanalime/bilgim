# Product

Bilgim is an online education platform connecting teachers and students, with live classes, course catalog, enrollment, homework, gamification, and real-time messaging.

## Core capabilities

- **Catalog & discovery** — browse and search courses/teachers.
- **Enrollment** — students enroll in courses and lessons.
- **Live classes** — real-time video/audio teaching via LiveKit and a mediasoup SFU, plus a collaborative whiteboard (tldraw).
- **Homework** — assignment creation, submission, and grading.
- **Gamification** — points, achievements, and progress to drive engagement.
- **Messaging & notifications** — direct messages (DM) and multi-channel notifications (in-app, email, Telegram).
- **AI assistance** — Claude-powered features for tutoring/content help.
- **Content protection** — screen-capture detection and media access controls to protect course content.

## Surfaces

- **Web** (`apps/web`) — primary student/teacher experience.
- **Mobile** (`apps/mobile`) — Expo/React Native companion app.
- **API** (`apps/api`) — backend serving both clients.

## Domain notes

- Audience and locale center on Uzbekistan (payments via Payme, `bilgim.uz`), with i18n support.
- Security and content protection are first-class product concerns, not afterthoughts.
