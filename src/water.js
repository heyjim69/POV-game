/* =============================================================
   RIVER VILLAGE — water.js
   Custom shaded river surface: gentle Gerstner swell, two scrolling
   normal maps, depth-tinted turquoise, fresnel sky reflection and a
   sun glint. Also builds the whitewater rapids under the long bridge.
   ============================================================= */
(function (RV) {
  'use strict';

  var W = RV.water = {};
  W.LEVEL = 0.0;                 // world-space water plane height

  /* Analytic riverbed. Mirrored exactly in the shader so the water's
     depth tint lines up with the geometry the player can stand on. */
  W.bedY = function (x, z) {
    var ax = Math.abs(x);
    // deep channel in the middle, shelving up towards the banks
    var d = RV.lerp(-6.5, -0.35, RV.smoothstep(20.0, 42.0, ax));
    // gentle undulation along the river's length
    d += Math.sin(z * 0.08) * 0.55 + Math.cos(x * 0.11 + z * 0.05) * 0.35;
    return d;
  };

  /* Wave height in JS — used for splashes, boat bob and swim bobbing.
     Must match waveH() in the vertex shader below. */
  W.height = function (x, z, t) {
    var h = 0.0;
    h += 0.055 * Math.sin((x * 0.970 + z * 0.243) * 0.898 + t * 0.54);
    h += 0.035 * Math.sin((-x * 0.514 + z * 0.857) * 1.496 + t * 1.35);
    h += 0.020 * Math.sin((x * 0.287 - z * 0.958) * 2.618 + t * 3.40);
    return h;
  };

  var WAVE_GLSL = [
    'float waveH(vec2 p, float t){',
    '  float h = 0.0;',
    '  h += 0.055 * sin((p.x*0.970 + p.y*0.243) * 0.898 + t*0.54);',
    '  h += 0.035 * sin((-p.x*0.514 + p.y*0.857) * 1.496 + t*1.35);',
    '  h += 0.020 * sin((p.x*0.287 - p.y*0.958) * 2.618 + t*3.40);',
    '  return h;',
    '}',
    'float bedY(vec2 p){',
    '  float ax = abs(p.x);',
    '  float d = mix(-6.5, -0.35, smoothstep(20.0, 42.0, ax));',
    '  d += sin(p.y*0.08)*0.55 + cos(p.x*0.11 + p.y*0.05)*0.35;',
    '  return d;',
    '}'
  ].join('\n');

  var VERT = [
    'varying vec3 vWorld;',
    'varying vec2 vUv;',
    'varying float vFogDepth;',
    'uniform float uTime;',
    WAVE_GLSL,
    'void main(){',
    '  vUv = uv;',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  wp.y += waveH(wp.xz, uTime);',
    '  vWorld = wp.xyz;',
    '  vec4 mv = viewMatrix * wp;',
    '  vFogDepth = -mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var FRAG = [
    'varying vec3 vWorld;',
    'varying vec2 vUv;',
    'varying float vFogDepth;',
    'uniform float uTime;',
    'uniform sampler2D uNormal;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uSunColor;',
    'uniform vec3 uDeep;',
    'uniform vec3 uShallow;',
    'uniform vec3 uSkyHorizon;',
    'uniform vec3 uSkyTop;',
    'uniform vec3 uFogColor;',
    'uniform float uFogDensity;',
    'uniform float uUnderwater;',
    WAVE_GLSL,
    'void main(){',
    '  vec2 p = vWorld.xz;',
    // analytic swell normal from the big waves
    '  float e = 0.45;',
    '  float hL = waveH(p - vec2(e,0.0), uTime), hR = waveH(p + vec2(e,0.0), uTime);',
    '  float hD = waveH(p - vec2(0.0,e), uTime), hU = waveH(p + vec2(0.0,e), uTime);',
    '  vec3 N = normalize(vec3(hL - hR, 2.0*e, hD - hU));',
    // two scrolling detail normal maps at different scales and drift
    '  vec2 uv1 = p * 0.085 + vec2(uTime*0.013, uTime*0.021);',
    '  vec2 uv2 = p * 0.031 - vec2(uTime*0.009, uTime*0.006);',
    '  vec3 n1 = texture2D(uNormal, uv1).xyz * 2.0 - 1.0;',
    '  vec3 n2 = texture2D(uNormal, uv2).xyz * 2.0 - 1.0;',
    '  vec3 det = normalize(vec3(n1.x + n2.x*0.8, 2.2, n1.y + n2.y*0.8));',
    '  N = normalize(vec3(N.x + det.x*0.55, 1.0, N.z + det.z*0.55));',
    '  vec3 V = normalize(cameraPosition - vWorld);',
    '  if (uUnderwater > 0.5) N = -N;',
    '  float ndv = clamp(dot(N, V), 0.0, 1.0);',
    // depth of water below this point -> colour
    '  float depth = clamp((0.0 - bedY(p)), 0.0, 7.0);',
    '  float dt = clamp(depth / 4.5, 0.0, 1.0);',
    '  vec3 body = mix(uShallow, uDeep, dt);',
    // fresnel sky reflection
    '  vec3 R = reflect(-V, N);',
    '  vec3 sky = mix(uSkyHorizon, uSkyTop, clamp(R.y*1.6, 0.0, 1.0));',
    '  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);',
    '  F = clamp(F, 0.0, 1.0);',
    '  vec3 col = mix(body, sky, F * 0.82);',
    // sun glint
    '  vec3 H = normalize(uSunDir + V);',
    '  float spec = pow(max(dot(N, H), 0.0), 420.0);',
    '  float wide = pow(max(dot(N, H), 0.0), 26.0);',
    '  col += uSunColor * (spec * 3.2 + wide * 0.10);',
    // shoreline foam where the bed nearly breaks the surface
    '  float shore = 1.0 - smoothstep(0.05, 0.85, depth);',
    '  float ripple = sin(depth*26.0 - uTime*2.2 + n1.x*3.0)*0.5 + 0.5;',
    '  col = mix(col, vec3(0.72,0.80,0.78), shore * (0.30 + ripple*0.35));',
    // seen from below the surface is a dim shimmering ceiling
    '  if (uUnderwater > 0.5) {',
    '    col = mix(uDeep * 0.55, sky * 0.55, F*0.5) + uSunColor * spec * 0.6;',
    '  }',
    // exponential-squared fog, matched to the scene fog
    '  float fd = uFogDensity * vFogDepth;',
    '  float fog = 1.0 - exp(-fd * fd);',
    '  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /**
   * Build the river surface.
   * @param {object} env  scene environment colours (sun, fog, sky)
   */
  W.build = function (env, normalTex) {
    var geo = new THREE.PlaneGeometry(520, 520, 200, 200);
    geo.rotateX(-Math.PI / 2);
    var uni = {
      uTime: { value: 0 },
      uNormal: { value: normalTex },
      uSunDir: { value: env.sunDir.clone() },
      uSunColor: { value: env.sunColor.clone() },
      uDeep: { value: RV.col(0x07322f) },
      uShallow: { value: RV.col(0x2f7d72) },
      uSkyHorizon: { value: env.fogColor.clone() },
      uSkyTop: { value: env.skyTop.clone() },
      uFogColor: { value: env.fogColor.clone() },
      uFogDensity: { value: env.fogDensity },
      uUnderwater: { value: 0 }
    };
    var mat = new THREE.ShaderMaterial({
      uniforms: uni,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = W.LEVEL;
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    W.mesh = mesh;
    W.mat = mat;
    return mesh;
  };

  W.update = function (t, underwater) {
    if (!W.mat) return;
    W.mat.uniforms.uTime.value = t;
    W.mat.uniforms.uUnderwater.value = underwater ? 1 : 0;
  };

  /* -------------------------------------------------------------
     RAPIDS — a fast, foaming strip of whitewater under the long
     suspension bridge. Sells the "rushing water" of the set-piece.
     ------------------------------------------------------------- */
  var RAP_FRAG = [
    'varying vec2 vUv;',
    'varying float vFogDepth;',
    'uniform sampler2D uFoam;',
    'uniform float uTime;',
    'uniform vec3 uFogColor;',
    'uniform float uFogDensity;',
    'void main(){',
    '  vec2 a = vUv * vec2(3.0, 9.0) + vec2(sin(vUv.y*8.0+uTime*0.7)*0.03, -uTime*0.55);',
    '  vec2 b = vUv * vec2(5.0, 15.0) + vec2(cos(vUv.y*6.0-uTime*0.9)*0.04, -uTime*0.95);',
    '  vec2 c = vUv * vec2(1.6, 5.0) + vec2(0.0, -uTime*0.32);',
    '  float f = texture2D(uFoam, a).a * 0.55 + texture2D(uFoam, b).a * 0.35 + texture2D(uFoam, c).a * 0.45;',
    '  f = smoothstep(0.30, 0.90, f);',
    // fade out at the strip edges so it blends into the calm river
    '  float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);',
    '  edge *= smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);',
    '  float a2 = f * edge;',
    '  vec3 col = mix(vec3(0.55,0.72,0.70), vec3(0.95,1.0,0.99), f);',
    '  float fd = uFogDensity * vFogDepth;',
    '  float fog = 1.0 - exp(-fd*fd);',
    '  col = mix(col, uFogColor, clamp(fog,0.0,1.0));',
    '  gl_FragColor = vec4(col, a2 * 0.9);',
    '  if (gl_FragColor.a < 0.01) discard;',
    '}'
  ].join('\n');

  var RAP_VERT = [
    'varying vec2 vUv;',
    'varying float vFogDepth;',
    'uniform float uTime;',
    'void main(){',
    '  vUv = uv;',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  wp.y += sin(wp.z*1.4 + uTime*5.0)*0.045 + cos(wp.x*2.1 - uTime*4.0)*0.03;',
    '  vec4 mv = viewMatrix * wp;',
    '  vFogDepth = -mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  W.buildRapids = function (env, foamTex, cx, cz, w, d) {
    var geo = new THREE.PlaneGeometry(w, d, 24, 60);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uFoam: { value: foamTex },
        uTime: { value: 0 },
        uFogColor: { value: env.fogColor.clone() },
        uFogDensity: { value: env.fogDensity }
      },
      vertexShader: RAP_VERT,
      fragmentShader: RAP_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    var m = new THREE.Mesh(geo, mat);
    m.position.set(cx, W.LEVEL + 0.07, cz);
    m.renderOrder = 3;
    W.rapidsMat = mat;
    W.rapidsCenter = new THREE.Vector3(cx, 0, cz);
    W.rapidsHalf = { w: w / 2, d: d / 2 };
    return m;
  };

  W.updateRapids = function (t) {
    if (W.rapidsMat) W.rapidsMat.uniforms.uTime.value = t;
  };

  /** 0..1 how much the player is inside the rapids' earshot. */
  W.rapidsProximity = function (pos) {
    if (!W.rapidsCenter) return 0;
    var dx = Math.abs(pos.x - W.rapidsCenter.x) - W.rapidsHalf.w;
    var dz = Math.abs(pos.z - W.rapidsCenter.z) - W.rapidsHalf.d;
    var d = Math.max(0, Math.max(dx, dz));
    return RV.clamp(1 - d / 26, 0, 1);
  };

})(window.RV);
