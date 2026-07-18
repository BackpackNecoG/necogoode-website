# Byte-Sized Training — Lesson 1

Deployable static lesson package for **A Week with Mr. Bryte · Day 1: The Grocery Run**.

## Run locally

Open `index.html` directly, or serve this folder with any static HTTP server.

## Azure deployment

Upload the complete folder contents without changing the relative paths. Set `index.html` as the default document. The application has no build step, package manager, API, or server-side dependency.

## Package structure

- `index.html` — application shell
- `styles.css` — responsive comic/lesson presentation
- `lesson.js` — all 12 lesson pages and answer models
- `app.js` — navigation, questions, repairs, hints, progress, and personalization
- `assets/characters/` — locked character references used by cast pages
- `assets/scenes/` — illustrated story scenes used inside lesson pages

## Validation behavior

- Question pages lock progression until answered.
- Build pages validate the selected Python operation.
- Repair pages validate the submitted line against the lesson model.
- Mr. Bryte offers a contextual hint after 25 seconds.
- All personalization occurs locally in the browser.
