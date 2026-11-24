# Portfolio

Static site — no build step, no dependencies. Open `index.html`, or host the folder as-is.

## Hosting on GitHub Pages

Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
The site appears at `https://sashankvinnakota-jpg.github.io/portfolio-/` after a minute or two.

After it's live, edit the `og:image` line in `index.html` to the full URL
(`https://sashankvinnakota-jpg.github.io/portfolio-/img/full/testboard-green-led.jpg`)
so link previews show the photo.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The whole site: homepage plus the project view |
| `theme.css` | Homepage theme — hero, photo title bands, project rows, contact sheet |
| `style.css` | Project pages — the drafting-sheet layout and all lab internals |
| `js/main.js` | Project list, write-ups, photo captions, lightbox, routing |
| `js/studio.js`, `js/common.js` | Shared three.js rendering helpers |
| `js/hub-*.js`, `js/lab-*.js`, `js/pace-dsp.js` | The five project simulations |
| `img/full`, `img/thumb` | Bench photographs |
| `img/vid` | Short clips |
| `lib/` | three.js r128 and OrbitControls, vendored |

## Adding a bench photo

Drop the image in `img/full/` and a smaller copy in `img/thumb/` under the same name,
then add a line to the `SHOTS` array in `js/main.js`:

```js
['my-photo', 'A caption describing what is in the frame.'],
```

A clip instead: put `name.mp4` and a poster `name.jpg` in `img/vid/` and add `, 'vid'`
as a third item on the line.

## Marking a project in progress

Add its id to `STATUS` in `js/main.js`:

```js
const STATUS = { wearable: 'In progress', camera: 'In progress' };
```
