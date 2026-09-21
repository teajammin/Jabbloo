# Music waiting to be made into loops

Drop a track in here and run:

    node scripts/prepare-music.mjs <file.mp3> <battle|theme>

It trims the silence off both ends, folds the last four seconds back over the
opening so the thing actually loops instead of stopping and starting, and
encodes it at a bitrate meant for sitting under a fight rather than for
listening to on its own.

The originals stay here and are not committed — they are several megabytes
each and can be downloaded again from where they came from, which is recorded
in `public/music/credits.json`. What ships is the loop in `public/music/`.
