/* The Rive state machine drives both aurora styles. */
(function (root) {
  'use strict';

  var source = null;
  var filterId = 0;
  var clearPng = null;
  var sixLobePng = null;
  function decode(base64) {
    return Uint8Array.from(atob(base64), function (char) { return char.charCodeAt(0); }).buffer;
  }

  function eligible(appearance) {
    return Boolean(root.rive && root.BOO_ASSETS && appearance &&
      appearance.shape === 'aurora-cloud' &&
      appearance.eyeScale === 1 && appearance.eyeSpacing === 1 && appearance.eyeHeight === 0 &&
      appearance.idleEyes === 'original');
  }

  function transparentPng() {
    if (!clearPng) {
      var blank = document.createElement('canvas');
      blank.width = blank.height = 2;
      clearPng = new Uint8Array(decode(blank.toDataURL('image/png').split(',')[1]));
    }
    return clearPng;
  }

  function sixLobeOutline() {
    if (!sixLobePng) {
      // Load as a bundled image: the chat page deliberately disallows fetch.
      sixLobePng = new Promise(function (resolve, reject) {
        var image = new Image();
        image.onload = function () {
          try {
            var sheet = document.createElement('canvas');
            sheet.width = image.naturalWidth; sheet.height = image.naturalHeight;
            sheet.getContext('2d').drawImage(image, 0, 0);
            resolve(new Uint8Array(decode(sheet.toDataURL('image/png').split(',')[1])));
          } catch (error) { reject(error); }
        };
        image.onerror = function () { reject(new Error('Six-lobe cloud texture could not be loaded')); };
        image.src = 'assets/aurora-six-lobe-body.png';
      }).catch(function (error) {
        sixLobePng = null;
        throw error;
      });
    }
    return sixLobePng;
  }

  function hsl(red, green, blue) {
    var max = Math.max(red, green, blue), min = Math.min(red, green, blue);
    var spread = max - min, light = (max + min) / 2, hue = 0, saturation = 0;
    if (spread) {
      saturation = spread / (1 - Math.abs(2 * light - 1));
      switch (max) {
        case red: hue = ((green - blue) / spread) % 6; break;
        case green: hue = (blue - red) / spread + 2; break;
        default: hue = (red - green) / spread + 4;
      }
      hue = (hue * 60 + 360) % 360;
    }
    return [hue, saturation, light];
  }

  function rgb(hue, saturation, light) {
    var chroma = (1 - Math.abs(2 * light - 1)) * saturation;
    var segment = ((hue % 360) + 360) % 360 / 60;
    var secondary = chroma * (1 - Math.abs(segment % 2 - 1));
    var channels = segment < 1 ? [chroma, secondary, 0] : segment < 2 ? [secondary, chroma, 0] :
      segment < 3 ? [0, chroma, secondary] : segment < 4 ? [0, secondary, chroma] :
        segment < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
    return channels.map(function (channel) { return Math.round((channel + light - chroma / 2) * 255); });
  }

  function hexHsl(hex) {
    return hsl(parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
  }

  async function tintPng(bytes, appearance, name) {
    var bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    var sheet = document.createElement('canvas');
    sheet.width = bitmap.width;
    sheet.height = bitmap.height;
    var context = sheet.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    var frame = context.getImageData(0, 0, sheet.width, sheet.height);
    var pixels = frame.data;
    var body = name === 'outline';
    var base = hexHsl('#5B3BC7');
    var bodyTarget = hexHsl(appearance.bodyColor);
    var pinkBase = hexHsl('#D05ED6');
    var goldBase = hexHsl('#D0AD8A');
    var pink = hexHsl(appearance.glowPinkColor);
    var gold = hexHsl(appearance.glowGoldColor);
    for (var index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 0) continue;
      var current = hsl(pixels[index] / 255, pixels[index + 1] / 255, pixels[index + 2] / 255);
      var target = body ? bodyTarget : (current[0] > 160 ? pink : gold);
      var reference = body ? base : (current[0] > 160 ? pinkBase : goldBase);
      var simpleBody = body && appearance.auroraStyle === 'simple';
      var simple = simpleBody && appearance.bodyColor === '#5B3BC7';
      var x = (index / 4 % sheet.width) / sheet.width;
      var y = Math.floor(index / 4 / sheet.width) / sheet.height;
      var hue = simple ? 260 - 20 * y : current[0] + target[0] - reference[0];
      var saturation = simple ? .94 : Math.min(1, Math.max(0, current[1] * target[1] / Math.max(.01, reference[1])));
      var light = simple ? .7 - .055 * y :
        Math.min(.97, Math.max(.03, current[2] + (target[2] - reference[2]) * .75));
      var color = rgb(hue, saturation, light);
      if (simpleBody) {
        var blush = .58 * Math.exp(-Math.pow((x - .44) / .2, 2) - Math.pow((y - .43) / .22, 2));
        color = color.map(function (channel, component) {
          return Math.round(channel * (1 - blush) + [255, 162, 178][component] * blush);
        });
      }
      pixels[index] = color[0]; pixels[index + 1] = color[1]; pixels[index + 2] = color[2];
      if (simpleBody) {
        pixels[index + 3] = Math.min(255, Math.max(0, (pixels[index + 3] - 1) * 55));
        // Keep the face opaque in the simple gradient style.
        if (x > .54 && x < .66 && y > .18 && y < .34) pixels[index + 3] = 255;
      }
    }
    context.putImageData(frame, 0, 0);
    var output = await new Promise(function (resolve) { sheet.toBlob(resolve, 'image/png'); });
    return new Uint8Array(await output.arrayBuffer());
  }

  function create(container, appearance, referenceTexture, preview) {
    if (!eligible(appearance)) return null;
    if (!source) {
      root.rive.RuntimeLoader.setWasmBinary(decode(root.BOO_ASSETS.wasm));
      source = decode(root.BOO_ASSETS.riv);
    }
    var svg = container.querySelector(':scope > svg');
    if (!svg) return null;
    var canvas = document.createElement('canvas');
    canvas.className = 'eb-rive-aurora';
    canvas.dataset.auroraContour = 'six-lobe';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.opacity = String(1 - appearance.auroraTransparency / 100);
    container.appendChild(canvas);
    var eyeFilter = null;
    if (String(appearance.eyeColor).toUpperCase() !== '#FFFFFF') {
      var id = 'eb-rive-eye-' + ++filterId;
      eyeFilter = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      eyeFilter.setAttribute('class', 'eb-rive-eye-filter');
      eyeFilter.innerHTML = '<filter id="' + id + '" color-interpolation-filters="sRGB">' +
        '<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  16 16 16 0 -47" result="bright"/>' +
        '<feMorphology in="bright" operator="erode" radius="1" result="inner"/>' +
        '<feMorphology in="inner" operator="dilate" radius="1" result="mask"/>' +
        '<feFlood flood-color="' + appearance.eyeColor + '" result="paint"/>' +
        '<feComposite in="paint" in2="mask" operator="in" result="tinted"/>' +
        '<feComposite in="tinted" in2="SourceGraphic" operator="over"/>' +
        '</filter>';
      container.appendChild(eyeFilter);
      canvas.style.filter = 'url(#' + id + ')';
    }

    var instance = null;
    var inputs = null;
    var clickIndex = 0;
    var destroyed = false;
    var assetJobs = [];
    var readyResolve;
    var readyPromise = new Promise(function (resolve) { readyResolve = resolve; });
    var reducedMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var active = true;
    function setActive(value) {
      if (destroyed) return;
      active = Boolean(value);
      reducedMotion = Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (!instance || !inputs) return;
      if (!active || reducedMotion) { inputs.hover.value = false; instance.pause(); }
      else { instance.play(); hover(container.matches(':hover')); }
    }
    function hover(value) {
      if (inputs) inputs.hover.value = active && !reducedMotion && Boolean(value);
    }
    function enter() { hover(true); }
    function leave() { hover(false); }
    function clickPreview() { click(); }
    function resize() { if (instance && inputs) instance.resizeDrawingSurfaceToCanvas(); }
    container.addEventListener('pointerenter', enter);
    container.addEventListener('pointerleave', leave);
    if (preview) container.addEventListener('click', clickPreview);
    root.addEventListener('resize', resize);

    function click() {
      if (!inputs || !active || reducedMotion) return false;
      inputs.index.value = clickIndex++ % 3;
      inputs.click.fire();
      return true;
    }
    function destroy() {
      destroyed = true;
      readyResolve(false);
      container.removeEventListener('pointerenter', enter);
      container.removeEventListener('pointerleave', leave);
      if (preview) container.removeEventListener('click', clickPreview);
      root.removeEventListener('resize', resize);
      instance && instance.cleanup();
      if (svg.isConnected) svg.style.visibility = '';
      eyeFilter && eyeFilter.remove();
      canvas.remove();
    }

    instance = new root.rive.Rive({
      buffer: source, canvas: canvas, stateMachines: 'Main_SM', autoplay: true,
      shouldDisableRiveListeners: true, enableRiveAssetCDN: false,
      assetLoader: function (asset, bytes) {
        var name = asset.name;
        var light = ['shape', 'shape_1', 'shape_2', 'explode'].includes(name);
        var simple = appearance.auroraStyle === 'simple';
        var sixLobe = name === 'outline' && appearance.auroraContour === 'six-lobe';
        var changed = name === 'outline' && (sixLobe || simple || appearance.bodyColor !== '#5B3BC7') ||
          light && (simple || appearance.glowPinkColor !== '#D05ED6' || appearance.glowGoldColor !== '#D0AD8A');
        if (!changed) return false;
        var job = (async function () {
          if (sixLobe) bytes = await sixLobeOutline();
          var png = simple && light ? transparentPng() : await tintPng(bytes, appearance, name);
          var rendered = await root.rive.decodeImage(png);
          if (destroyed) { rendered.unref(); return; }
          asset.setRenderImage(rendered);
          if (sixLobe) canvas.dataset.auroraOutlineReady = 'true';
          rendered.unref();
        }());
        assetJobs.push(job);
        return true;
      },
      onLoad: function () {
        if (destroyed) return;
        instance.resizeDrawingSurfaceToCanvas();
        var list = instance.stateMachineInputs('Main_SM');
        inputs = {
          index: list.find(function (input) { return input.name === 'clickIndex'; }),
          click: list.find(function (input) { return input.name === 'click'; }),
          hover: list.find(function (input) { return input.name === 'isHover'; })
        };
        if (!inputs.index || !inputs.click || !inputs.hover) { readyResolve(false); return; }
        Promise.all(assetJobs).then(function () {
          if (destroyed) return;
          setActive(active);
          // The desktop window can finish sizing after Rive's onLoad callback.
          setTimeout(function () {
            if (destroyed) return;
            instance.resizeDrawingSurfaceToCanvas();
            svg.style.visibility = 'hidden';
            canvas.classList.add('ready');
            readyResolve(true);
          }, 160);
        }).catch(function (error) { console.error('Aurora asset:', error); readyResolve(false); });
      }
    });
    return { click: click, destroy: destroy, setActive: setActive,
      ready: function () { return canvas.classList.contains('ready'); }, whenReady: function () { return readyPromise; } };
  }

  root.AuroraRive = Object.freeze({ create: create, eligible: eligible });
}(window));
