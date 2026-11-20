# Anatomy Lab

Serve the dist directory with a static HTTPS server. The atlas requires WebGL 2 and the browser DecompressionStream API. No API key or build step is required.

The male body contains 2,827 structures. The female body contains 1,209 structures, including the HuBMAP female surface and pelvic anatomy, Visible Human Female lower-limb muscles, and supplemental BodyParts3D bones and cartilage. Whole-body mode arranges parts in rows. The system picker shows only the selected system and spaces its structures apart in three dimensions. Each body loads on demand. The separation slider interpolates their transforms into a shelf layout. Click or tap a part for its name and short note. Search and focus work without changing the separation slider.

The specimen directory includes seven gzip-compressed geometry buffers, the part catalog, and upstream attribution. See dist/credits.html for the source assets and licenses. Run node verify.mjs to validate the geometry buffers, coordinate bounds, structure IDs, and triangle indices.

