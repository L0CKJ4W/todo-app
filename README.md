# To Do

A private to-do app for iPhone, installed from Safari as a Home Screen web app. No App Store, no Mac, no Apple ID.

- Lists, each with a name, and folders to group lists in
- Item status: Not started, In progress, On hold, Complete
- Sort items (date added, recently changed, A–Z, grouped by status) and filter by status or search text
- Sort and search lists on the home screen
- Works offline; backup and restore through a JSON file

## Privacy

Your lists are stored only on the device, in the app's local storage. The app never sends them anywhere: there is no server, account, or analytics. Hosting the app's *code* publicly does not expose your lists, because the lists are never on the host.

On iPhone, the Home Screen app keeps its own storage, separate from Safari tabs. iOS does not clear a Home Screen app's storage the way it can for websites you haven't visited in a while. Even so, use **⋯ → Back up (export)** now and then and save the file to iCloud Drive or Files.

## Run it on this PC

```
node tools/serve.mjs
```

Then open http://localhost:8080/.

## Put it on your iPhone

The app is hosted on GitHub Pages at **https://l0ckj4w.github.io/todo-app/**, published from the `main` branch of this repo. There is no build step.

1. Open that URL in **Safari** on the iPhone.
2. Tap **Share**, then **Add to Home Screen**.
3. Open it from the Home Screen icon. It now runs full screen and works offline.

## Updating

After you change any file, bump `VERSION` in `sw.js` (for example `v2` → `v3`), commit, and `git push`. GitHub Pages republishes within a minute or two. The app on the phone picks up the new version the next time it opens with a connection, and shows it on the launch after that.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page shell and iOS Home Screen settings |
| `app.js` | Home and list screens, menus, backup |
| `store.js` | Data model and saving to local storage |
| `ui.js` | Dialogs, action sheets, toasts, icons |
| `styles.css` | iOS-style look, light and dark mode |
| `sw.js` | Offline cache |
| `tools/make-icons.mjs` | Regenerates the app icons |
| `tools/serve.mjs` | Local test server |
