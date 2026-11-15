# Liquid Glass for the Web (third-party)

The glass look of the Batchly site, used here for the controls that float over the sky and the
photos. Version 1.3.0, MIT licence (see `LICENSE`). These are the minified files the Batchly site
build produces from its `public/glass/liquid-glass.js` and `liquid-glass.css`.

This is third-party code. It was not written for Tombaugh and is not part of the project's
AI-generated code; it carries its own licence banner instead of the project header. The only
change: the script is wrapped in a function so its two minifier helpers stay out of the global
scope.

Without it (or in a browser that cannot run it) the page falls back to its plain dark controls.
