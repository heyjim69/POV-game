/* =============================================================
   RIVER VILLAGE — postfx.js
   The scene renders into a half-float target; this pass does the
   grade: underwater distortion, damage vignette, chromatic edges,
   film grain, ACES tone mapping and the sRGB encode.
   ============================================================= */
(function (RV) {
  'use strict';

  var PF = RV.postfx = {};
  var rt = null, quad = null, postScene = null, postCam = null, mat = null;

  var FRAG = [
    'uniform sampler2D tDiffuse;',
    'uniform float uTime;',
    'uniform float uUnder;',      // 0..1 how submerged the camera is
    'uniform float uDamage;',     // recent damage
    'uniform float uFlash;',      // white hit flash
    'uniform float uLow;',        // low-health desaturation
    'uniform float uAspect;',
    'uniform float uExposure;',
    'uniform float uFade;',       // black fade for start/death
    'varying vec2 vUv;',

    'vec3 aces(vec3 x){',
    '  float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;',
    '  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);',
    '}',
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }',
    'vec3 toSRGB(vec3 c){',
    '  return mix(c*12.92, 1.055*pow(max(c,vec3(0.0001)), vec3(1.0/2.4))-0.055, step(0.0031308, c));',
    '}',

    'void main(){',
    '  vec2 uv = vUv;',
    '  vec2 cen = uv - 0.5;',
    '  float r = length(cen * vec2(uAspect, 1.0));',

    // --- underwater: refraction wobble ---
    '  if (uUnder > 0.001) {',
    '    float w1 = sin(uv.y*26.0 + uTime*2.1) * 0.0055;',
    '    float w2 = cos(uv.x*19.0 - uTime*1.6) * 0.0045;',
    '    float w3 = sin((uv.x+uv.y)*33.0 + uTime*3.3) * 0.0022;',
    '    uv += vec2(w1 + w3, w2 - w3) * uUnder;',
    '  }',

    // --- chromatic aberration towards the edges ---
    '  float ca = (0.0016 + uUnder*0.004 + uDamage*0.004) * smoothstep(0.15, 0.85, r);',
    '  vec3 col;',
    '  col.r = texture2D(tDiffuse, uv + cen*ca).r;',
    '  col.g = texture2D(tDiffuse, uv).g;',
    '  col.b = texture2D(tDiffuse, uv - cen*ca).b;',

    '  col *= uExposure;',

    // --- underwater grade ---
    '  if (uUnder > 0.001) {',
    '    vec3 wet = col * vec3(0.42, 0.86, 0.86);',
    '    wet += vec3(0.010, 0.035, 0.033) * (1.0 + sin(uTime*1.4 + uv.y*8.0)*0.4);',
    '    float dark = 1.0 - smoothstep(0.12, 0.80, r) * 0.38;',
    '    wet *= dark;',
    '    col = mix(col, wet, uUnder);',
    '  }',

    // --- tone map + encode ---
    '  col = aces(col);',
    // cool the shadows, take a little saturation out of the highlights
    '  float lum = dot(col, vec3(0.299,0.587,0.114));',
    '  col = mix(col, vec3(lum), 0.10);',
    '  col = mix(col, col * vec3(0.90, 1.00, 1.02), 1.0 - lum);',

    // --- low health: desaturate and pulse ---
    '  if (uLow > 0.001) {',
    '    float g = dot(col, vec3(0.299,0.587,0.114));',
    '    col = mix(col, vec3(g)*vec3(1.06,0.92,0.92), uLow*0.75);',
    '    float pulse = 0.5 + 0.5*sin(uTime*3.4);',
    '    col *= 1.0 - uLow * 0.16 * pulse;',
    '  }',

    // --- damage vignette ---
    '  float dv = smoothstep(0.20, 0.78, r) * uDamage;',
    '  col = mix(col, vec3(0.42, 0.03, 0.02), clamp(dv, 0.0, 0.88));',

    // --- standard vignette ---
    '  col *= 1.0 - smoothstep(0.45, 1.05, r) * 0.55;',

    // --- hit flash ---
    '  col += vec3(uFlash);',

    // --- film grain ---
    '  float g2 = hash(uv * vec2(1024.0, 768.0) + fract(uTime)*97.0);',
    '  col += (g2 - 0.5) * 0.022 * (0.35 + 0.65 * smoothstep(0.0, 0.35, lum));',

    '  col = toSRGB(max(col, vec3(0.0)));',
    '  col *= uFade;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var VERT = [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');

  PF.init = function (renderer, width, height) {
    var pr = renderer.getPixelRatio();
    rt = new THREE.WebGLRenderTarget(Math.floor(width * pr), Math.floor(height * pr), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false
    });
    rt.texture.encoding = THREE.LinearEncoding;
    rt.texture.generateMipmaps = false;

    mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: rt.texture },
        uTime: { value: 0 },
        uUnder: { value: 0 },
        uDamage: { value: 0 },
        uFlash: { value: 0 },
        uLow: { value: 0 },
        uAspect: { value: width / height },
        uExposure: { value: 0.94 },
        uFade: { value: 1 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false
    });

    var geo = new THREE.PlaneGeometry(2, 2);
    quad = new THREE.Mesh(geo, mat);
    quad.frustumCulled = false;
    postScene = new THREE.Scene();
    postScene.add(quad);
    postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    PF.target = rt;
    PF.material = mat;
  };

  PF.resize = function (renderer, width, height) {
    if (!rt) return;
    var pr = renderer.getPixelRatio();
    rt.setSize(Math.floor(width * pr), Math.floor(height * pr));
    mat.uniforms.uAspect.value = width / height;
  };

  PF.set = function (name, value) {
    if (mat && mat.uniforms[name]) mat.uniforms[name].value = value;
  };

  PF.render = function (renderer) {
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  };

})(window.RV);
