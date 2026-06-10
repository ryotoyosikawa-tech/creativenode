/* ============================================================
   Creative Node — Interactions & WebGL
   ============================================================ */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

clearTimeout(window.__cnFallback);
document.documentElement.classList.add('js');

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
gsap.registerPlugin(ScrollTrigger);

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
const isMobile = window.innerWidth < 860;

/* ============================================================
   Smooth scroll (Lenis)
   ============================================================ */
let lenis = null;
if (!prefersReduced) {
    lenis = new Lenis({
        duration: 1.15,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
}

function scrollToTarget(target) {
    if (lenis) {
        lenis.scrollTo(target, { offset: 0, duration: 1.4 });
    } else {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
}

document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        if (id.length > 1 && document.querySelector(id)) {
            e.preventDefault();
            closeMenu();
            scrollToTarget(id);
        }
    });
});

/* ============================================================
   WebGL — Node Network
   ============================================================ */
const glState = {
    x: 1.15, y: 0, scale: 1,
    rotX: 0, rotY: 0, rotZ: 0,
    opacity: 1,
    intro: 0, // 0→1 during intro
    morph: 0, // スクロール連動モーフ（間奏セクション）
    morphIntro: 0, // オープニングの単語モーフ（CREATE→CONNECT→NODE.）
    spin: 0, // オープニングで単語が回転しながら組み上がる演出用
};

// initWebGL内で差し替えられる: オープニングモーフの単語切り替え
let setIntroWord = () => {};

let renderer = null;

function initWebGL() {
    const canvas = document.getElementById('webgl');
    if (!canvas || !window.WebGLRenderingContext) return;

    try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch (e) {
        return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.75 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 50);
    camera.position.z = 4.4;

    const group = new THREE.Group();
    scene.add(group);

    /* ----- Nodes ----- */
    const NODE_COUNT = isMobile ? 150 : 320;
    const basePositions = new Float32Array(NODE_COUNT * 3);
    const phases = new Float32Array(NODE_COUNT * 3);
    const sizes = new Float32Array(NODE_COUNT);
    const colors = new Float32Array(NODE_COUNT * 3);

    const cA = new THREE.Color('#4f46e5'); // indigo
    const cB = new THREE.Color('#0d9488'); // teal
    const cC = new THREE.Color('#1c1a2e'); // deep ink
    const tmp = new THREE.Color();

    for (let i = 0; i < NODE_COUNT; i++) {
        // organic spherical cloud (shell-biased)
        const dir = new THREE.Vector3(
            Math.random() * 2 - 1,
            Math.random() * 2 - 1,
            Math.random() * 2 - 1
        ).normalize();
        const r = 0.55 + Math.pow(Math.random(), 0.62) * 1.25;
        basePositions[i * 3]     = dir.x * r;
        basePositions[i * 3 + 1] = dir.y * r * 0.92;
        basePositions[i * 3 + 2] = dir.z * r;

        phases[i * 3]     = Math.random() * Math.PI * 2;
        phases[i * 3 + 1] = Math.random() * Math.PI * 2;
        phases[i * 3 + 2] = Math.random() * Math.PI * 2;

        // mostly small nodes, a few large glowing hubs
        sizes[i] = Math.random() < 0.1
            ? 2.4 + Math.random() * 1.4
            : 0.6 + Math.random() * 1.3;

        // mix of indigo / teal / ink nodes
        const pick = Math.random();
        if (pick < 0.5) tmp.copy(cA);
        else if (pick < 0.8) tmp.copy(cB);
        else tmp.copy(cC);
        tmp.offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
        colors[i * 3] = tmp.r;
        colors[i * 3 + 1] = tmp.g;
        colors[i * 3 + 2] = tmp.b;
    }

    const positions = new Float32Array(basePositions);

    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    pointsGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    function pointsMatTemplate() {
        return new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: {
                uOpacity: { value: 1 },
                uPixelRatio: { value: renderer.getPixelRatio() },
                uTime: { value: 0 },
                uMorph: { value: 0 },
            },
            vertexShader: `
                attribute float aSize;
                attribute vec3 aColor;
                varying vec3 vColor;
                varying float vSize;
                varying float vDepth;
                uniform float uPixelRatio;
                uniform float uTime;
                uniform float uMorph;
                void main() {
                    vColor = aColor;
                    vSize = aSize;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    // 奥行き（空気遠近用）
                    vDepth = clamp((-mv.z - 2.6) / 4.0, 0.0, 1.0);
                    float pulse = 1.0 + 0.14 * sin(uTime * 1.6 + position.x * 4.0 + position.y * 3.0);
                    // モーフ時は大粒子ほど縮めて文字をシャープに
                    float morphShrink = 1.0 - uMorph * clamp((aSize - 0.55) * 0.55, 0.0, 0.7);
                    gl_PointSize = aSize * 30.0 * pulse * morphShrink * uPixelRatio / -mv.z;
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vSize;
                varying float vDepth;
                uniform float uOpacity;
                uniform float uMorph;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    // 鋭い芯＋ガウシアンの柔らかな光輪（小粒子ほど芯を太くして消えないように）
                    float coreR = mix(0.34, 0.16, clamp((vSize - 0.4) * 1.1, 0.0, 1.0));
                    float core = smoothstep(coreR, coreR * 0.3, d);
                    float glow = exp(-d * d * 10.0) * 0.42 * (1.0 - core);
                    // 大きめのノードには極細のリングを纏わせる
                    float ring = smoothstep(0.028, 0.012, abs(d - 0.34))
                               * smoothstep(1.5, 2.3, vSize)
                               * (1.0 - uMorph) * 0.55;
                    float a = (core + glow + ring) * uOpacity;
                    // モーフ時は色を藍に寄せて文字の輪郭を読みやすく
                    vec3 col = mix(vColor, vec3(0.27, 0.25, 0.85), uMorph * 0.5);
                    // 奥のノードは白へ溶かす（空気遠近）
                    col = mix(col, vec3(1.0), vDepth * 0.5);
                    a *= 1.0 - vDepth * 0.45;
                    if (a < 0.01) discard;
                    gl_FragColor = vec4(col, a);
                }
            `,
        });
    }
    const pointsMat = pointsMatTemplate();

    const points = new THREE.Points(pointsGeo, pointsMat);
    group.add(points);

    /* ----- Connections ----- */
    const pairs = [];
    const MAX_PER_NODE = 3;
    const linkCount = new Uint8Array(NODE_COUNT);
    const THRESHOLD = isMobile ? 0.58 : 0.48;
    for (let i = 0; i < NODE_COUNT; i++) {
        for (let j = i + 1; j < NODE_COUNT; j++) {
            if (linkCount[i] >= MAX_PER_NODE) break;
            if (linkCount[j] >= MAX_PER_NODE) continue;
            const dx = basePositions[i * 3] - basePositions[j * 3];
            const dy = basePositions[i * 3 + 1] - basePositions[j * 3 + 1];
            const dz = basePositions[i * 3 + 2] - basePositions[j * 3 + 2];
            if (dx * dx + dy * dy + dz * dz < THRESHOLD * THRESHOLD) {
                pairs.push(i, j);
                linkCount[i]++;
                linkCount[j]++;
            }
        }
    }

    const linePositions = new Float32Array(pairs.length * 3);
    const lineColors = new Float32Array(pairs.length * 3);
    const linesGeo = new THREE.BufferGeometry();
    linesGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    linesGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    // 白背景なので「白に溶かす」ことで線ごとの透明度を表現する
    const LINE_TINT = { r: 0.16, g: 0.15, b: 0.27 }; // 藍鼠
    const linesMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthWrite: false,
    });
    const lines = new THREE.LineSegments(linesGeo, linesMat);
    group.add(lines);

    /* ----- Ambient dust ----- */
    const DUST_COUNT = isMobile ? 120 : 260;
    const dustPos = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
        dustPos[i * 3]     = (Math.random() - 0.5) * 11;
        dustPos[i * 3 + 1] = (Math.random() - 0.5) * 7;
        dustPos[i * 3 + 2] = (Math.random() - 0.5) * 5 - 0.5;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
        color: 0x6b6880,
        size: 0.015,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        sizeAttenuation: true,
    });
    const dust = new THREE.Points(dustGeo, dustMat);
    scene.add(dust);

    /* ----- Morph targets: 粒子が「NODE.」の文字へ集合 ----- */
    const morphTargets = new Float32Array(basePositions);
    const morphDelays = new Float32Array(NODE_COUNT);
    for (let i = 0; i < NODE_COUNT; i++) morphDelays[i] = Math.random() * 0.4;
    let morphReady = false;

    // 文字の充填用追加粒子（モーフ時のみフェードイン）
    const MORPH_COUNT = isMobile ? 700 : 1600;
    const mpStart = new Float32Array(MORPH_COUNT * 3);
    const mpPositions = new Float32Array(MORPH_COUNT * 3);
    const mpTargets = new Float32Array(MORPH_COUNT * 3);
    const mpDelays = new Float32Array(MORPH_COUNT);
    const mpSizes = new Float32Array(MORPH_COUNT);
    const mpColors = new Float32Array(MORPH_COUNT * 3);
    for (let i = 0; i < MORPH_COUNT; i++) {
        const dir = new THREE.Vector3(
            Math.random() * 2 - 1,
            Math.random() * 2 - 1,
            Math.random() * 2 - 1
        ).normalize();
        const r = 1.2 + Math.random() * 2.2; // 周囲から飛んでくる
        mpStart[i * 3]     = dir.x * r;
        mpStart[i * 3 + 1] = dir.y * r * 0.8;
        mpStart[i * 3 + 2] = dir.z * r;
        mpDelays[i] = Math.random() * 0.4;
        mpSizes[i] = 0.38 + Math.random() * 0.42;
        const pick = Math.random();
        if (pick < 0.5) tmp.copy(cA);
        else if (pick < 0.8) tmp.copy(cB);
        else tmp.copy(cC);
        mpColors[i * 3] = tmp.r;
        mpColors[i * 3 + 1] = tmp.g;
        mpColors[i * 3 + 2] = tmp.b;
    }
    mpPositions.set(mpStart);
    const mpGeo = new THREE.BufferGeometry();
    mpGeo.setAttribute('position', new THREE.BufferAttribute(mpPositions, 3));
    mpGeo.setAttribute('aSize', new THREE.BufferAttribute(mpSizes, 1));
    mpGeo.setAttribute('aColor', new THREE.BufferAttribute(mpColors, 3));
    const mpMat = pointsMatTemplate();
    const morphPts = new THREE.Points(mpGeo, mpMat);
    morphPts.visible = false;
    group.add(morphPts);

    // オープニングモーフ用の独立ターゲットバッファ
    const introNodeT = new Float32Array(basePositions);
    const introExtraT = new Float32Array(MORPH_COUNT * 3);
    const wordCache = {};

    function sampleWord(word) {
        const W = 1700, H = 300; // 長い単語＋文字間隔でも切れない幅
        const cnv = document.createElement('canvas');
        cnv.width = W;
        cnv.height = H;
        const ctx = cnv.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.fillStyle = '#000';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 12; // 線を太らせて粒子の載る面積を増やす
        ctx.letterSpacing = '18px'; // 文字間を空けて1文字ずつ読みやすく
        ctx.font = '800 200px Syne, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(word, W / 2, H / 2);
        ctx.strokeText(word, W / 2, H / 2);
        const textW = Math.min(ctx.measureText(word).width, W);

        const data = ctx.getImageData(0, 0, W, H).data;
        const pts = [];
        for (let y = 0; y < H; y += 3) {
            for (let x = 0; x < W; x += 3) {
                if (data[(y * W + x) * 4 + 3] > 128) pts.push(x, y);
            }
        }
        if (pts.length < 16) return null;

        // 画面幅に収まるワールド幅に変換
        const visibleW = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * camera.position.z * camera.aspect;
        const scale = Math.min(4.8, visibleW * 0.82) / textW;
        // 層化サンプリング: 候補点を均等に拾って文字全体をムラなくカバー
        const total = pts.length / 2;
        const fill = (arr, count) => {
            const stride = total / count;
            for (let i = 0; i < count; i++) {
                const k = Math.min(total - 1, (i * stride + Math.random() * stride) | 0);
                arr[i * 3]     = (pts[k * 2] - W / 2) * scale;
                arr[i * 3 + 1] = -(pts[k * 2 + 1] - H / 2) * scale;
                arr[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
            }
        };
        const node = new Float32Array(NODE_COUNT * 3);
        const extra = new Float32Array(MORPH_COUNT * 3);
        fill(node, NODE_COUNT);
        fill(extra, MORPH_COUNT);
        return { node, extra };
    }

    function getWord(word) {
        if (!wordCache[word]) wordCache[word] = sampleWord(word);
        return wordCache[word];
    }

    function buildTargets() {
        const s = getWord(isMobile ? 'N' : 'NODE');
        if (!s) return;
        morphTargets.set(s.node);
        mpTargets.set(s.extra);
        morphReady = true;
    }
    setIntroWord = (word) => {
        const s = getWord(word);
        if (!s) return;
        introNodeT.set(s.node);
        introExtraT.set(s.extra);
    };
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(buildTargets);
    } else {
        buildTargets();
    }

    /* ----- Mouse parallax ----- */
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    if (!isTouch) {
        window.addEventListener('pointermove', (e) => {
            mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
        });
    }

    /* ----- Scroll journey ----- */
    if (!prefersReduced) {
        const journey = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: {
                trigger: document.body,
                start: 'top top',
                end: 'bottom bottom',
                scrub: 1.2,
            },
        });
        // hero → about: drift left & grow
        journey.to(glState, { x: -1.3, scale: 1.5, rotY: 1.6, rotZ: 0.15, opacity: 0.65, duration: 0.24 }, 0);
        // about → services/pricing: recede behind content
        journey.to(glState, { x: 1.2, y: 0.3, scale: 1.05, rotY: 3.1, opacity: 0.4, duration: 0.24 }, 0.24);
        // pricing → projects: drift across
        journey.to(glState, { x: -1.0, y: -0.1, scale: 1.2, rotY: 4.4, rotZ: -0.1, opacity: 0.5, duration: 0.2 }, 0.48);
        // → interlude: center stage for the morph
        journey.to(glState, { x: 0, y: 0, scale: 1.1, rotY: 6.0, rotZ: 0, opacity: 1, duration: 0.18 }, 0.68);
        // → contact: recede softly behind the form
        journey.to(glState, { x: 0, y: 0.15, scale: 0.85, rotY: 7.2, opacity: 0.5, duration: 0.14 }, 0.86);

        // パーティクルモーフ: 間奏セクションで「NODE.」に集合 → 通過で解散
        const morphTl = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: {
                trigger: '#interlude',
                start: 'top bottom',
                end: 'bottom top',
                scrub: 1,
            },
        });
        morphTl.to(glState, { morph: 1, duration: 0.35, ease: 'power2.out' }, 0);
        morphTl.to(glState, { morph: 1, duration: 0.27 }, 0.35); // hold
        morphTl.to(glState, { morph: 0, duration: 0.33, ease: 'power2.in' }, 0.62);

        // 間奏キャプションのフェードイン・アウト
        morphTl.fromTo('#interlude-caption',
            { opacity: 0, y: 30 },
            { opacity: 1, y: 0, duration: 0.16 }, 0.2);
        morphTl.to('#interlude-caption',
            { opacity: 0, y: -24, duration: 0.14 }, 0.56);

        // 可読性ベール: セクション位置に正確に連動（本文の多い中盤は濃く）
        gsap.fromTo('#gl-veil', { opacity: 0 }, {
            opacity: 0.62,
            ease: 'none',
            scrollTrigger: {
                trigger: '#about',
                start: 'top bottom',
                end: 'top 55%',
                scrub: true,
            },
        });
        gsap.fromTo('#gl-veil', { opacity: 0.62 }, {
            opacity: 0.06,
            ease: 'none',
            immediateRender: false,
            scrollTrigger: {
                trigger: '#interlude',
                start: 'top 90%',
                end: 'top 30%',
                scrub: true,
            },
        });
        gsap.fromTo('#gl-veil', { opacity: 0.06 }, {
            opacity: 0.42,
            ease: 'none',
            immediateRender: false,
            scrollTrigger: {
                trigger: '#contact',
                start: 'top 90%',
                end: 'top 40%',
                scrub: true,
            },
        });
    }

    if (isMobile) {
        glState.x = 0;
        glState.y = 0.85;
        glState.scale = 0.78;
        glState.opacity = 0.55; // keep hero text readable on small screens
    }

    /* ----- Render loop ----- */
    const clock = new THREE.Clock();
    let rafActive = true;

    document.addEventListener('visibilitychange', () => {
        rafActive = !document.hidden;
    });

    function render() {
        requestAnimationFrame(render);
        if (!rafActive) return;

        const t = clock.getElapsedTime();
        const mScroll = morphReady ? glState.morph : 0;
        const mIntro = morphReady ? glState.morphIntro : 0;
        const m = Math.max(mScroll, mIntro);
        // イントロとスクロールでターゲット文字を切り替え
        const tgtN = mIntro > mScroll ? introNodeT : morphTargets;
        const tgtE = mIntro > mScroll ? introExtraT : mpTargets;

        // breathing nodes (＋モーフ時は文字座標へ集合)
        for (let i = 0; i < NODE_COUNT; i++) {
            const i3 = i * 3;
            let x = basePositions[i3]     + Math.sin(t * 0.5 + phases[i3]) * 0.055;
            let y = basePositions[i3 + 1] + Math.sin(t * 0.42 + phases[i3 + 1]) * 0.055;
            let z = basePositions[i3 + 2] + Math.sin(t * 0.36 + phases[i3 + 2]) * 0.055;
            if (m > 0) {
                // ノードごとに遅延をつけて段階的に組み上がる
                let mi = (m * 1.45 - morphDelays[i]) / 1.05;
                mi = mi < 0 ? 0 : mi > 1 ? 1 : mi;
                mi = mi * mi * (3 - 2 * mi);
                const inv = 1 - mi;
                x = x * inv + (tgtN[i3]     + Math.sin(t * 1.2 + phases[i3]) * 0.006) * mi;
                y = y * inv + (tgtN[i3 + 1] + Math.sin(t * 1.1 + phases[i3 + 1]) * 0.006) * mi;
                z = z * inv + tgtN[i3 + 2] * mi;
            }
            positions[i3] = x;
            positions[i3 + 1] = y;
            positions[i3 + 2] = z;
        }
        pointsGeo.attributes.position.needsUpdate = true;

        // 線: 距離が近いほど濃く、伸びるほど白に溶ける
        const lineFade = glState.opacity * glState.intro * (1 - m);
        for (let p = 0; p < pairs.length; p += 2) {
            const a = pairs[p] * 3;
            const b = pairs[p + 1] * 3;
            const o = p * 3;
            linePositions[o]     = positions[a];
            linePositions[o + 1] = positions[a + 1];
            linePositions[o + 2] = positions[a + 2];
            linePositions[o + 3] = positions[b];
            linePositions[o + 4] = positions[b + 1];
            linePositions[o + 5] = positions[b + 2];

            const dx = positions[a] - positions[b];
            const dy = positions[a + 1] - positions[b + 1];
            const dz = positions[a + 2] - positions[b + 2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            let near = 1 - dist / THRESHOLD;
            if (near < 0) near = 0;
            const strength = (0.05 + near * 0.34) * lineFade;
            const cr = 1 - (1 - LINE_TINT.r) * strength;
            const cg = 1 - (1 - LINE_TINT.g) * strength;
            const cb = 1 - (1 - LINE_TINT.b) * strength;
            lineColors[o]     = cr; lineColors[o + 1] = cg; lineColors[o + 2] = cb;
            lineColors[o + 3] = cr; lineColors[o + 4] = cg; lineColors[o + 5] = cb;
        }
        linesGeo.attributes.position.needsUpdate = true;
        linesGeo.attributes.color.needsUpdate = true;

        // smooth mouse
        mouse.x += (mouse.tx - mouse.x) * 0.04;
        mouse.y += (mouse.ty - mouse.y) * 0.04;

        const introEase = glState.intro;
        const minv = 1 - m; // モーフ中はカメラ正面・無回転へ収束
        group.position.x = (glState.x + mouse.x * 0.12) * minv;
        group.position.y = (glState.y - mouse.y * 0.1) * minv;
        const s = glState.scale * (0.55 + introEase * 0.45) * minv + 1.0 * m;
        group.scale.set(s, s, s);
        group.rotation.y = (glState.rotY + t * 0.05 + mouse.x * 0.18) * minv;
        group.rotation.x = (glState.rotX + mouse.y * 0.12) * minv;
        group.rotation.z = glState.rotZ * minv + glState.spin;

        pointsMat.uniforms.uOpacity.value = Math.min(glState.opacity + m * 0.6, 1) * introEase;
        pointsMat.uniforms.uTime.value = t;
        pointsMat.uniforms.uMorph.value = m;
        dustMat.opacity = 0.32 * Math.min(glState.opacity + 0.2, 1) * introEase;

        // 文字充填用の追加粒子（モーフ時のみ）
        if (m > 0.001 && morphReady) {
            morphPts.visible = true;
            for (let i = 0; i < MORPH_COUNT; i++) {
                const i3 = i * 3;
                let mi = (m * 1.45 - mpDelays[i]) / 1.05;
                mi = mi < 0 ? 0 : mi > 1 ? 1 : mi;
                mi = mi * mi * (3 - 2 * mi);
                const inv = 1 - mi;
                mpPositions[i3]     = mpStart[i3] * inv + (tgtE[i3]     + Math.sin(t * 1.3 + i) * 0.006) * mi;
                mpPositions[i3 + 1] = mpStart[i3 + 1] * inv + (tgtE[i3 + 1] + Math.cos(t * 1.1 + i) * 0.006) * mi;
                mpPositions[i3 + 2] = mpStart[i3 + 2] * inv + tgtE[i3 + 2] * mi;
            }
            mpGeo.attributes.position.needsUpdate = true;
            mpMat.uniforms.uOpacity.value = Math.min(m * 1.5, 1) * introEase;
            mpMat.uniforms.uTime.value = t;
            mpMat.uniforms.uMorph.value = m;
        } else {
            morphPts.visible = false;
        }

        dust.rotation.y = t * 0.012;

        renderer.render(scene, camera);
    }
    render();

    /* ----- Resize ----- */
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        pointsMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
        mpMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    });
}

initWebGL();

/* ============================================================
   Split text (chars)
   ============================================================ */
function splitChars(el) {
    const text = el.textContent;
    el.textContent = '';
    const frag = document.createDocumentFragment();
    [...text].forEach((ch) => {
        const span = document.createElement('span');
        span.className = 'char';
        span.textContent = ch === ' ' ? ' ' : ch;
        frag.appendChild(span);
    });
    el.appendChild(frag);
    el.classList.add('is-split');
    return el.querySelectorAll('.char');
}

/* ============================================================
   Preloader & Intro
   ============================================================ */
const preloader = document.getElementById('preloader');
const countEl = document.getElementById('preloader-count');
const heroChars = [];
document.querySelectorAll('.hero .split-target').forEach((el) => {
    heroChars.push(...splitChars(el));
});

function runIntro() {
    // オープニング: 粒子が言葉を紡いでから散開する
    const words = isMobile
        ? [
            { w: 'CREATE', jp: 'つくる。' },
            { w: 'NODE', jp: '人と人を、むすぶ。' },
        ]
        : [
            { w: 'CREATE', jp: 'つくる。' },
            { w: 'CONNECT', jp: 'つなぐ。' },
            { w: 'NODE', jp: '人と人を、むすぶ。' },
        ];
    const caption = document.getElementById('intro-caption');
    if (lenis) lenis.stop();
    // 演出中は単語に舞台を独占させる
    gsap.set(['.header', '.scroll-indicator'], { opacity: 0 });

    const tl = gsap.timeline({
        onComplete: () => {
            if (lenis) lenis.start();
        },
    });
    tl.to(preloader, {
        yPercent: -100,
        duration: 0.9,
        ease: 'power4.inOut',
    });
    tl.set(preloader, { display: 'none' });
    tl.to(glState, { intro: 1, duration: 0.7, ease: 'power2.out' }, '-=0.45');

    words.forEach((item, idx) => {
        const isLast = idx === words.length - 1;
        tl.call(() => {
            setIntroWord(item.w);
            caption.textContent = item.jp;
        });
        // わずかに回転しながら組み上がる
        tl.fromTo(glState, { spin: -0.045 }, { spin: 0, duration: 0.9, ease: 'power3.out' });
        tl.to(glState, { morphIntro: 1, duration: 0.7, ease: 'power3.out' }, '<');
        tl.fromTo(caption,
            { opacity: 0, y: 14 },
            { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' },
            '-=0.3'
        );
        tl.to(caption, { opacity: 0, y: -12, duration: 0.3, ease: 'power2.in' }, '+=0.5');
        if (isLast) {
            // 最後の単語はゆっくり散開してネットワークへ
            tl.to(glState, { morphIntro: 0, duration: 1.1, ease: 'power2.inOut' }, '-=0.1');
        } else {
            // 一旦ゆるめて次の単語へ
            tl.to(glState, { morphIntro: 0.12, duration: 0.32, ease: 'power2.inOut' }, '-=0.12');
        }
    });

    // 散開と同時にヒーローを登場させる
    tl.call(() => document.querySelector('.hero-inner').classList.add('is-ready'), null, '-=1.0');
    tl.fromTo(heroChars,
        { yPercent: 115 },
        { yPercent: 0, duration: 1.1, ease: 'power4.out', stagger: 0.045 },
        '-=0.9'
    );
    tl.to(['.header', '.scroll-indicator'], { opacity: 1, duration: 0.8, ease: 'power2.out' }, '<');
    tl.fromTo('.hero [data-reveal]',
        { opacity: 0, y: 28 },
        { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12, clearProps: 'transform' },
        '-=0.7'
    );
    tl.fromTo('.hero-outline span',
        { opacity: 0, x: 60 },
        { opacity: 1, x: 0, duration: 1.4, ease: 'power3.out' },
        '-=1.0'
    );
}

if (prefersReduced) {
    if (countEl) countEl.textContent = '100';
    gsap.set(preloader, { display: 'none' });
    gsap.set('[data-reveal]', { opacity: 1 });
    gsap.set(heroChars, { yPercent: 0 });
    gsap.set('#gl-veil', { opacity: 0.45 }); // スクロール連動なしでも可読性を確保
    document.querySelector('.hero-inner').classList.add('is-ready');
    glState.intro = 1;
} else {
    const progress = { v: 0 };
    const minWait = gsap.to(progress, {
        v: 100,
        duration: 1.4,
        ease: 'power2.inOut',
        onUpdate: () => {
            if (countEl) countEl.textContent = Math.round(progress.v);
        },
    });
    Promise.all([
        document.fonts ? document.fonts.ready : Promise.resolve(),
        new Promise((res) => minWait.eventCallback('onComplete', res)),
    ]).then(runIntro);
}

/* ============================================================
   Scroll reveals
   ============================================================ */
if (!prefersReduced) {
    document.querySelectorAll('[data-reveal]').forEach((el) => {
        if (el.closest('.hero')) return; // hero handled by intro
        if (el.classList.contains('section-title')) return; // 文字分解で個別処理
        gsap.fromTo(el,
            { opacity: 0, y: 44 },
            {
                opacity: 1,
                y: 0,
                duration: 1.1,
                ease: 'power3.out',
                clearProps: 'transform',
                scrollTrigger: {
                    trigger: el,
                    start: 'top 88%',
                    once: true,
                },
            }
        );
    });

    // セクションタイトル: 文字分解リビール
    document.querySelectorAll('.section-title').forEach((title) => {
        const chars = splitChars(title);
        gsap.set(title, { opacity: 1 });
        gsap.fromTo(chars,
            { yPercent: 115 },
            {
                yPercent: 0,
                duration: 0.9,
                ease: 'power4.out',
                stagger: 0.028,
                scrollTrigger: {
                    trigger: title,
                    start: 'top 88%',
                    once: true,
                },
            }
        );
    });

    // マーキー: スクロール速度に反応して加速
    const marqueeTrack = document.querySelector('.marquee-track');
    if (marqueeTrack) {
        marqueeTrack.style.animation = 'none';
        const marqueeTween = gsap.to(marqueeTrack, {
            xPercent: -50,
            duration: 26,
            ease: 'none',
            repeat: -1,
        });
        if (lenis) {
            lenis.on('scroll', (e) => {
                const ts = Math.min(1 + Math.abs(e.velocity) * 0.045, 3.4);
                gsap.to(marqueeTween, { timeScale: ts, duration: 0.4, overwrite: true });
            });
        }
    }

    // hero outline parallax
    gsap.to('.hero-outline span', {
        xPercent: -14,
        ease: 'none',
        scrollTrigger: {
            trigger: '.hero',
            start: 'top top',
            end: 'bottom top',
            scrub: 0.8,
        },
    });
}

/* ============================================================
   Price counters
   ============================================================ */
document.querySelectorAll('[data-counter]').forEach((el) => {
    const target = parseInt(el.dataset.counter, 10);
    if (isNaN(target) || prefersReduced) return;
    const obj = { v: 0 };
    gsap.to(obj, {
        v: target,
        duration: 1.6,
        ease: 'power3.out',
        onUpdate: () => {
            el.textContent = Math.round(obj.v).toLocaleString('ja-JP');
        },
        scrollTrigger: {
            trigger: el,
            start: 'top 90%',
            once: true,
        },
    });
});

/* ============================================================
   Scroll progress bar
   ============================================================ */
const progressBar = document.getElementById('scroll-progress');
function updateProgress() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
}
window.addEventListener('scroll', updateProgress, { passive: true });
window.addEventListener('resize', updateProgress);
updateProgress();

/* ============================================================
   Sound design (WebAudio合成・デフォルトOFF)
   ============================================================ */
const soundToggle = document.getElementById('sound-toggle');
const sfx = { enabled: false, ctx: null };

function sfxEnsure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!sfx.ctx && AC) sfx.ctx = new AC();
    if (sfx.ctx && sfx.ctx.state === 'suspended') sfx.ctx.resume();
}

function blip(freq, dur, gain, type = 'sine') {
    if (!sfx.enabled || !sfx.ctx) return;
    const t0 = sfx.ctx.currentTime;
    const osc = sfx.ctx.createOscillator();
    const g = sfx.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(sfx.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
}

function setSound(on) {
    sfx.enabled = on;
    soundToggle.classList.toggle('is-on', on);
    soundToggle.setAttribute('aria-pressed', String(on));
    soundToggle.setAttribute('aria-label', on ? 'サウンドをオフにする' : 'サウンドをオンにする');
    try { localStorage.setItem('cn-sound', on ? '1' : '0'); } catch (e) { /* private mode */ }
}

soundToggle.addEventListener('click', () => {
    sfxEnsure();
    setSound(!sfx.enabled);
    if (sfx.enabled) blip(660, 0.18, 0.05);
});

try {
    if (localStorage.getItem('cn-sound') === '1') {
        setSound(true);
        // AudioContextはユーザー操作後でないと動かないため、最初の操作で起動
        window.addEventListener('pointerdown', sfxEnsure, { once: true });
    }
} catch (e) { /* private mode */ }

if (!isTouch) {
    document.querySelectorAll('a, button, .price-row, .feature-row').forEach((el) => {
        el.addEventListener('pointerenter', () => blip(1320, 0.05, 0.012));
    });
}
window.addEventListener('click', () => blip(440, 0.08, 0.02, 'triangle'));

/* ============================================================
   Header behavior
   ============================================================ */
const header = document.getElementById('header');
let lastY = 0;
function onScrollHeader() {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 40);
    if (y > 200 && y > lastY + 6 && !menuOpen) {
        header.classList.add('is-hidden');
    } else if (y < lastY - 6 || y <= 200) {
        header.classList.remove('is-hidden');
    }
    lastY = y;
}
window.addEventListener('scroll', onScrollHeader, { passive: true });

/* ============================================================
   Fullscreen menu
   ============================================================ */
const menuToggle = document.getElementById('menu-toggle');
const menuOverlay = document.getElementById('menu-overlay');
let menuOpen = false;

function openMenu() {
    menuOpen = true;
    menuOverlay.classList.add('is-open');
    menuOverlay.setAttribute('aria-hidden', 'false');
    menuToggle.classList.add('is-active');
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.setAttribute('aria-label', 'メニューを閉じる');
    if (lenis) lenis.stop();
}
function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    menuOverlay.classList.remove('is-open');
    menuOverlay.setAttribute('aria-hidden', 'true');
    menuToggle.classList.remove('is-active');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'メニューを開く');
    if (lenis) lenis.start();
}
menuToggle.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()));
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
});

/* ============================================================
   Custom cursor
   ============================================================ */
if (!isTouch && !prefersReduced) {
    const cursor = document.querySelector('.cursor');
    const dot = cursor.querySelector('.cursor-dot');
    const ring = cursor.querySelector('.cursor-ring');
    const pos = { x: -100, y: -100, rx: -100, ry: -100 };

    window.addEventListener('pointermove', (e) => {
        pos.x = e.clientX;
        pos.y = e.clientY;
    });
    window.addEventListener('pointerdown', () => cursor.classList.add('is-down'));
    window.addEventListener('pointerup', () => cursor.classList.remove('is-down'));

    gsap.ticker.add(() => {
        pos.rx += (pos.x - pos.rx) * 0.16;
        pos.ry += (pos.y - pos.ry) * 0.16;
        dot.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
        ring.style.transform = `translate(${pos.rx}px, ${pos.ry}px) translate(-50%, -50%)`;
    });

    document.querySelectorAll('[data-cursor], a, button').forEach((el) => {
        el.addEventListener('pointerenter', () => cursor.classList.add('is-hover'));
        el.addEventListener('pointerleave', () => cursor.classList.remove('is-hover'));
    });
}

/* ============================================================
   Magnetic buttons
   ============================================================ */
if (!isTouch && !prefersReduced) {
    document.querySelectorAll('[data-magnetic]').forEach((el) => {
        const strength = 0.32;
        el.addEventListener('pointermove', (e) => {
            const rect = el.getBoundingClientRect();
            const dx = e.clientX - (rect.left + rect.width / 2);
            const dy = e.clientY - (rect.top + rect.height / 2);
            gsap.to(el, {
                x: dx * strength,
                y: dy * strength,
                duration: 0.5,
                ease: 'power3.out',
            });
        });
        el.addEventListener('pointerleave', () => {
            gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.45)' });
        });
    });
}

/* ============================================================
   Card tilt
   ============================================================ */
if (!isTouch && !prefersReduced) {
    document.querySelectorAll('[data-tilt]').forEach((card) => {
        const MAX = 4;
        card.addEventListener('pointermove', (e) => {
            const rect = card.getBoundingClientRect();
            const px = (e.clientX - rect.left) / rect.width - 0.5;
            const py = (e.clientY - rect.top) / rect.height - 0.5;
            gsap.to(card, {
                rotateY: px * MAX,
                rotateX: -py * MAX,
                transformPerspective: 900,
                duration: 0.55,
                ease: 'power2.out',
            });
        });
        card.addEventListener('pointerleave', () => {
            gsap.to(card, { rotateY: 0, rotateX: 0, duration: 0.9, ease: 'elastic.out(1, 0.5)' });
        });
    });
}
