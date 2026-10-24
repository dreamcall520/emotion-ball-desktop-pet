# Sheep assets

The reviewed runtime PNG atlases and manifest are committed under `assets/sheep/`.
Normal app packaging uses these files directly; it does not regenerate artwork.
`tests/fixtures/sheep-source-frames.json` records frame hashes and timing.

Rebuilding artwork requires the separately retained, reviewed source images and
their source configuration. These originals are not included in this repository.
The build-time Python tools need Pillow and NumPy; they are not app dependencies.

- `build-sheep-assets.py <source-config.json>` converts reviewed source animation
  files into runtime atlases. An optional second argument `<theme>/<action>`
  limits regeneration.
- `build-christmas-upright.py <source-config.json> --qa-dir <output>
  --idle-art-dir <reviewed-idle-art> --working-eyes-dir <reviewed-eye-patches>`
  retains the Christmas performances and applies the reviewed standing/mouth and
  working-eye repairs. Supply both repair directories to reproduce the accepted
  character; do not overwrite the checked-in assets with unreviewed sources.
- `python desktop-pet/tests/sheep_asset_converter_test.py` checks the converter
  with temporary generated input, without rewriting app assets.

Current limitations retained from the accepted candidate: some legacy pose and
sleep-to-standing transitions still need refinement. Resizing the main pet window
currently resets the random offering opportunity; brief animation interruptions
preserve its deadline. Neither limitation is changed by the Git integration.
