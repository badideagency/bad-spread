var SpreadCore = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region spread/src/identity.ts
	function baseName(name) {
		return name.trim().replace(/\.[A-Za-z0-9]{1,5}$/, "");
	}
	function identify(fileName) {
		const b = baseName(fileName);
		let m = /^([A-Z])(\d{3})C(\d{3})_(\d{6})(\w{2})$/.exec(b);
		if (m) return {
			pattern: "cinema",
			device: m[1],
			recording: b,
			channel: null,
			order: [Number(m[2]), Number(m[3])]
		};
		m = /^C(\d{4})$/.exec(b);
		if (m) return {
			pattern: "sony",
			device: "Sony",
			recording: b,
			channel: null,
			order: [Number(m[1])]
		};
		m = /^DJI_(\d+)_(\d{8})_(\d{6})$/.exec(b);
		if (m) return {
			pattern: "dji",
			device: "DJI",
			recording: b,
			channel: null,
			order: [
				Number(m[2]),
				Number(m[3]),
				Number(m[1])
			]
		};
		m = /^(\d{6})_(\d{6})_(Tr\w+)$/i.exec(b);
		if (m) return {
			pattern: "zoom",
			device: "Zoom",
			recording: `${m[1]}_${m[2]}`,
			channel: "Tr" + m[3].slice(2).toUpperCase(),
			order: [Number(m[1]), Number(m[2])]
		};
		const ch = /^(.*?)[_-](tr(?:\d+|lr|ms|mix|l|r)|lr|ms)$/i.exec(b);
		const rest = ch && ch[1] ? ch[1] : b;
		const channel = ch && ch[1] ? /^tr/i.test(ch[2]) ? "Tr" + ch[2].slice(2).toUpperCase() : ch[2].toUpperCase() : null;
		const groups = rest.match(/\d+/g) ?? [];
		return {
			pattern: "generic",
			device: rest.replace(/\d+/g, "").replace(/[\s._-]+/g, "_").replace(/^_+|_+$/g, "") || "#",
			recording: rest,
			channel,
			order: [groups.length ? Number(groups[groups.length - 1]) : 0]
		};
	}
	/** Harici ses kaynağının anahtarı (kaynak eşleme paneli): "Zoom Tr1", "Zoom TrLR", "DJI", … */
	function sourceKey(id) {
		return id.channel ? `${id.device} ${id.channel}` : id.device;
	}
	//#endregion
	//#region spread/src/core.ts
	var TICKS_PER_SECOND = 254016000000n;
	function big(t) {
		try {
			return BigInt(t);
		} catch {
			return 0n;
		}
	}
	function secOf(t) {
		const b = typeof t === "bigint" ? t : big(t);
		return (Number(b) / Number(TICKS_PER_SECOND)).toFixed(3);
	}
	function trackLabel(kind, track) {
		return `${kind}${track + 1}`;
	}
	//#endregion
	//#region spread/src/classify.ts
	var VIDEO_EXT = /* @__PURE__ */ new Set([
		"mp4",
		"mov",
		"mxf",
		"mts",
		"m2ts",
		"avi",
		"mkv",
		"m4v",
		"3gp",
		"mpg",
		"mpeg",
		"wmv",
		"r3d",
		"braw",
		"crm",
		"insv",
		"lrv",
		"hevc",
		"h264"
	]);
	var AUDIO_EXT = /* @__PURE__ */ new Set([
		"wav",
		"bwf",
		"mp3",
		"aif",
		"aiff",
		"m4a",
		"flac",
		"aac",
		"ogg",
		"wma",
		"caf"
	]);
	function fileName(c) {
		return c.projName && c.projName !== "?" ? c.projName : c.name;
	}
	function extOf(name) {
		const m = /\.([A-Za-z0-9]{1,5})$/.exec(name.trim());
		return m ? m[1].toLowerCase() : "";
	}
	function classify(s) {
		const out = [];
		const camIdent = /* @__PURE__ */ new Map();
		const mk = (clip, role, ident, why = "") => ({
			clip,
			role,
			ident,
			device: role === "camera" || role === "guide" ? ident.device : null,
			source: role === "external" ? sourceKey(ident) : null,
			why
		});
		for (const c of s.clips) {
			if (c.kind !== "V") continue;
			const fn = fileName(c);
			if (c.adjustment) out.push(mk(c, "unknown", null, "ayar katmanı"));
			else if (c.projId === "?") out.push(mk(c, "unknown", null, "proje öğesi okunamadı"));
			else if (!VIDEO_EXT.has(extOf(fn))) out.push(mk(c, "unknown", null, "video dosyası değil (grafik / metin / renk?)"));
			else {
				const id = identify(fn);
				out.push(mk(c, "camera", id));
				if (!camIdent.has(c.projId)) camIdent.set(c.projId, id);
			}
		}
		for (const c of s.clips) {
			if (c.kind !== "A") continue;
			const fn = fileName(c);
			if (c.projId !== "?" && camIdent.has(c.projId)) out.push(mk(c, "guide", camIdent.get(c.projId)));
			else if (c.projId === "?") out.push(mk(c, "unknown", null, "proje öğesi okunamadı"));
			else if (AUDIO_EXT.has(extOf(fn))) out.push(mk(c, "external", identify(fn)));
			else if (VIDEO_EXT.has(extOf(fn))) out.push(mk(c, "unknown", null, "kamera sesi ama videosu timeline'da yok"));
			else out.push(mk(c, "unknown", null, "ses dosyası değil"));
		}
		return out;
	}
	var cmpStart = (a, b) => {
		const d = big(a.start) - big(b.start);
		return d < 0n ? -1 : d > 0n ? 1 : a.kind !== b.kind ? a.kind === "V" ? -1 : 1 : a.track - b.track;
	};
	//#endregion
	//#region spread/src/sessions.ts
	var anchorLess = (a, b) => {
		const la = big(a.end) - big(a.start);
		const lb = big(b.end) - big(b.start);
		if (la !== lb) return la > lb;
		if (a.track !== b.track) return a.track < b.track;
		return big(a.start) < big(b.start);
	};
	/** Zamanda çakışan kamera klipleri → kümeler (aralık grafiğinin bağlı bileşenleri); çapa = en uzun (anchorLess). */
	function clusterCams(cams) {
		const sorted = cams.slice().sort(cmpStart);
		const groups = [];
		let cur = [];
		let curEnd = -1n;
		const flush = () => {
			if (!cur.length) return;
			let anchor = cur[0];
			for (const c of cur) if (anchorLess(c, anchor)) anchor = c;
			groups.push({
				cams: cur,
				anchor,
				start: big(cur[0].start),
				end: curEnd
			});
		};
		for (const c of sorted) if (cur.length && big(c.start) < curEnd) {
			cur.push(c);
			if (big(c.end) > curEnd) curEnd = big(c.end);
		} else {
			flush();
			cur = [c];
			curEnd = big(c.end);
		}
		flush();
		return groups;
	}
	var linkItemKey = (i) => [
		i.kind,
		i.track,
		i.start,
		i.end,
		i.name
	].join("|");
	var linkItemOf = (c) => ({
		kind: c.kind,
		track: c.track,
		start: c.start,
		end: c.end,
		name: fileName(c)
	});
	/**
	* KES'ten SONRAKİ düzenden bağlama grupları (analiz yok, yalnız düzen):
	*  - ana kamera videoları (V track < vPark; park'takiler hariç): zamanda çakışanlar → grup; çapa = en uzun (eşitlikte alt track).
	*    TOPLA oturumları zamanda ayrık dizdiği için zamanda çakışan kameralar AYNI oturumdadır.
	*  - harici ses (A track < aPark): çapanın İÇİNDE (start ≥ çapa.start ve end ≤ çapa.end) → o grubun. KES parçası = ses ∩ çapa:
	*    ses çapayı kapsıyorsa start/end çapayla BİREBİR aynı, kapsamıyorsa çapanın içinde kısa bir parça. Hiçbir çapanın içinde değil ama
	*    bir ana kameraya değiyorsa HATA (KES yapılmamış / düzen değişmiş); hiçbir ana kameraya değmiyorsa (kamerasız oturum) dokunulmaz.
	*  - "sil" track'inde klip bir ana kameraya değiyorsa → HATA (KES silmemiş); değmiyorsa (kamerasız oturum) dokunulmaz.
	*  - "korunan kamera sesi" track'indeki kamera sesi (v0.3.3: harici sesin olmadığı aralığa kesilmiş kılavuz): aynı kaynaklı kamerası
	*    onu kapsayan grubun; öyle bir kamera yoksa HATA.
	*  - kamera sesi (kılavuz track'lerinde): videosuyla aynı kaynak + aynı start/end → grubunda harici ses YOKSA grubun (kamera sesi
	*    korunur), VARSA HATA (KES kılavuzu silmemiş). Videosuyla aynı yerde olmayan kamera sesi: harici sesli bir grubun çapasına
	*    değiyorsa HATA, değilse dokunulmaz.
	*/
	function groupsFromLayout(items, frame) {
		const errors = [];
		const ignored = [];
		const at = (c) => `${trackLabel(c.kind, c.track)} "${c.name}" [${secOf(c.start)}s–${secOf(c.end)}s]`;
		const mainCams = items.filter((x) => x.role === "camera" && x.clip.track < frame.vPark).map((x) => x.clip);
		const groups = clusterCams(mainCams).map((k) => ({
			anchor: k.anchor,
			cams: k.cams,
			audio: []
		}));
		const inside = (c, g) => big(c.start) >= big(g.anchor.start) && big(c.end) <= big(g.anchor.end);
		const touches = (c, v) => big(c.start) < big(v.end) && big(v.start) < big(c.end);
		const sil = new Set(frame.silTracks);
		for (const x of items.filter((i) => i.role === "external" && i.clip.track < frame.aPark)) {
			const c = x.clip;
			const touchesCam = mainCams.some((v) => touches(c, v));
			if (sil.has(c.track)) {
				if (touchesCam) errors.push(`${at(c)}: "sil" kaynağının track'inde — KES silmemiş`);
				else ignored.push(`${at(c)}: "sil" kaynağı, hiçbir kameraya değmiyor (kamerasız oturum) — dokunulmaz`);
				continue;
			}
			const g = groups.find((q) => inside(c, q));
			if (g) g.audio.push(c);
			else if (touchesCam) errors.push(`${at(c)}: hiçbir çapanın içinde değil ama bir kameraya değiyor — KES yapılmamış ya da düzen değişmiş`);
			else ignored.push(`${at(c)}: hiçbir kameraya değmiyor (kamerasız oturum) — dokunulmaz`);
		}
		const hasExt = new Set(groups.filter((g) => g.audio.length).map((g) => g.anchor));
		const keptT = new Set(frame.keptTracks ?? []);
		for (const x of items.filter((i) => i.role === "guide" && keptT.has(i.clip.track))) {
			const c = x.clip;
			const g = groups.find((q) => q.cams.some((v) => v.projId === c.projId && big(v.start) <= big(c.start) && big(c.end) <= big(v.end)));
			if (g) g.audio.push(c);
			else errors.push(`${at(c)}: "korunan kamera sesi" track'inde ama aynı kaynaklı kamerası onu kapsamıyor — düzen değişmiş`);
		}
		for (const x of items.filter((i) => i.role === "guide" && i.clip.track < frame.aPark && !keptT.has(i.clip.track))) {
			const c = x.clip;
			const g = groups.find((q) => q.cams.some((v) => v.projId === c.projId && v.start === c.start && v.end === c.end));
			if (g) {
				if (hasExt.has(g.anchor)) errors.push(`${at(c)}: kamera sesi, grubunda harici ses varken duruyor — KES kılavuzu silmemiş`);
				else g.audio.push(c);
			} else if (groups.some((q) => hasExt.has(q.anchor) && touches(c, q.anchor))) errors.push(`${at(c)}: videosuyla aynı yerde olmayan kamera sesi harici sesli bir grupta — KES silmemiş`);
			else ignored.push(`${at(c)}: videosuyla aynı yerde olmayan kamera sesi — dokunulmaz`);
		}
		return {
			groups: groups.sort((a, b) => cmpStart(a.anchor, b.anchor)),
			errors,
			ignored
		};
	}
	/** Grubun öğeleri (bağlama isteği için). */
	var layoutGroupItems = (g) => [...g.cams.slice().sort(cmpStart), ...g.audio.slice().sort(cmpStart)].map(linkItemOf);
	/**
	* KES planındaki gruplar ile düzenden bulunan gruplar BİREBİR aynı mı (öğe kümeleri; sıra önemsiz). Yalnız ≥ 2 öğeli gruplar
	* bağlanır (tek öğeli grup iki tarafta da atlanır). Farklar satır satır; boşsa aynı.
	*/
	function compareLinkGroups(planned, found) {
		const sig = (items) => items.map(linkItemKey).sort().join("\n");
		const want = new Map(planned.filter((g) => g.items.length >= 2).map((g) => [sig(g.items), g.label]));
		const got = /* @__PURE__ */ new Map();
		for (const g of found) {
			const items = layoutGroupItems(g);
			if (items.length >= 2) got.set(sig(items), `çapa "${fileName(g.anchor)}" (${items.length} öğe)`);
		}
		const out = [];
		for (const [k, label] of want) if (!got.has(k)) out.push(`planda var, düzende YOK: ${label}`);
		for (const [k, label] of got) if (!want.has(k)) out.push(`düzende var, planda YOK: ${label}`);
		return out;
	}
	/**
	* v1.1.0 "yalnız bağla" (kesme bitmiş, bağlama kalmış): kullanıcı bu arada bazı öğeleri elle sildiyse planın grupları o an
	* düzende VAR olan öğelere indirilir; eksikler satır satır döner. Öğe anahtarı (tür, track, start, end, ad) birebir eşleşmeli —
	* yeri değişmiş öğe de "eksik" sayılır ve bağlanmaz. İndirilmiş gruplar yine compareLinkGroups ile düzenden bulunanlarla
	* karşılaştırılır (iki yol birbirinden sapamaz).
	*/
	function reduceToPresent(planned, present) {
		const missing = [];
		return {
			groups: planned.map((g) => {
				const items = g.items.filter((i) => present.has(linkItemKey(i)));
				for (const i of g.items) if (!present.has(linkItemKey(i))) missing.push(`${g.label}: ${trackLabel(i.kind, i.track)} "${i.name}" [${secOf(i.start)}s–${secOf(i.end)}s] yok`);
				return {
					...g,
					items
				};
			}),
			missing
		};
	}
	//#endregion
	//#region spread/src/channels.ts
	/** Kullanıcıya gösterilen ad (bilinmeyen değer sayıyla yazılır — tahmin yok). */
	function channelTypeName(t) {
		if (t === null) return "bilinmiyor";
		return {
			0: "mono",
			1: "stereo",
			2: "5.1",
			3: "çok kanallı",
			4: "4 kanal",
			5: "8 kanal"
		}[t] ?? `tip ${t}`;
	}
	/**
	* Gruptaki ses öğelerinden grubun ANA kanal tipine uymayanların index'leri (bağ dışında bırakılacak adaylar).
	* Ana tip: en çok ses öğesinin tipi; eşitlikte en küçük A track'teki öğenin tipi (Spread'in track çerçevesinde eşlenen harici
	* kaynaklar en üstteki A track'lerde, korunan kamera sesi ve kılavuzlar onların altında).
	* Karar verilmez ([] döner): tek tip varsa; bir ses öğesinin tipi okunamadıysa (tahmin yok); ana tipe uyan ses öğesi kalmayacaksa.
	* Video öğeleri hiçbir zaman aday değildir.
	*/
	function channelOutliers(items) {
		const audio = items.map((x, i) => ({
			...x,
			i
		})).filter((x) => x.kind === "A");
		if (audio.length < 2 || audio.some((x) => x.type === null)) return [];
		const count = /* @__PURE__ */ new Map();
		for (const x of audio) count.set(x.type, (count.get(x.type) ?? 0) + 1);
		if (count.size < 2) return [];
		const most = Math.max(...count.values());
		const top = audio.filter((x) => count.get(x.type) === most).sort((a, b) => a.track - b.track || a.i - b.i)[0];
		return audio.filter((x) => x.type !== top.type).map((x) => x.i);
	}
	//#endregion
	//#region spread/src/senkron.ts
	var SR = 8e3;
	var HOP = SR / 100;
	var DEFAULT_OPTS = {
		minNcc: .15,
		minPeak: .06,
		minSharp: 2,
		minRatio: 3,
		candidates: 4,
		minOverlapSec: 15,
		frameSec: 1001 / 24e3,
		tolSec: .002,
		fineHalfSec: 1,
		fineWinSec: 8,
		hintHalfSec: 10,
		wideSec: 60,
		clockTolSec: 30
	};
	var Cancelled = class extends Error {
		constructor() {
			super("iptal edildi");
		}
	};
	var plans = /* @__PURE__ */ new Map();
	function planOf(n) {
		let p = plans.get(n);
		if (p) return p;
		const bits = Math.round(Math.log2(n));
		if (1 << bits !== n) throw new Error("FFT boyu 2'nin kuvveti olmalı: " + n);
		const rev = new Uint32Array(n);
		for (let i = 0; i < n; i++) {
			let x = i;
			let r = 0;
			for (let b = 0; b < bits; b++) {
				r = r << 1 | x & 1;
				x >>= 1;
			}
			rev[i] = r >>> 0;
		}
		const cos = new Float64Array(n >> 1);
		const sin = new Float64Array(n >> 1);
		for (let k = 0; k < n >> 1; k++) {
			cos[k] = Math.cos(2 * Math.PI * k / n);
			sin[k] = Math.sin(2 * Math.PI * k / n);
		}
		p = {
			n,
			rev,
			cos,
			sin
		};
		if (plans.size > 8) plans.clear();
		plans.set(n, p);
		return p;
	}
	function fft(re, im, inverse) {
		const n = re.length;
		const p = planOf(n);
		for (let i = 0; i < n; i++) {
			const j = p.rev[i];
			if (j > i) {
				let t = re[i];
				re[i] = re[j];
				re[j] = t;
				t = im[i];
				im[i] = im[j];
				im[j] = t;
			}
		}
		for (let size = 2; size <= n; size <<= 1) {
			const half = size >> 1;
			const step = n / size;
			for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
				const wr = p.cos[k];
				const wi = inverse ? p.sin[k] : -p.sin[k];
				const a = i + j;
				const b = a + half;
				const tr = re[b] * wr - im[b] * wi;
				const ti = re[b] * wi + im[b] * wr;
				re[b] = re[a] - tr;
				im[b] = im[a] - ti;
				re[a] += tr;
				im[a] += ti;
			}
		}
		if (inverse) for (let i = 0; i < n; i++) {
			re[i] /= n;
			im[i] /= n;
		}
	}
	var pow2 = (x) => 1 << Math.ceil(Math.log2(Math.max(2, x)));
	/**
	* Çapraz korelasyon C[k] = Σ_m a[m]·b[m − k], k ∈ [−(Lb−1), La−1] → dizi indeksi k + (Lb − 1).
	* k > 0: b, a'dan k örnek SONRA başlar (pos(b) − pos(a) = k / hız). phat: GCC-PHAT ağırlığı.
	*/
	function xcorr(a, b, phat = false) {
		const La = a.length;
		const Lb = b.length;
		const n = pow2(La + Lb);
		const ar = new Float64Array(n);
		const ai = new Float64Array(n);
		const br = new Float64Array(n);
		const bi = new Float64Array(n);
		for (let i = 0; i < La; i++) ar[i] = a[i];
		for (let i = 0; i < Lb; i++) br[i] = b[i];
		fft(ar, ai, false);
		fft(br, bi, false);
		let mag = 0;
		for (let i = 0; i < n; i++) {
			const r = ar[i] * br[i] + ai[i] * bi[i];
			const im = ai[i] * br[i] - ar[i] * bi[i];
			ar[i] = r;
			ai[i] = im;
			if (phat) mag += Math.hypot(r, im);
		}
		if (phat) {
			const eps = mag / n * .001 + 1e-20;
			for (let i = 0; i < n; i++) {
				const m = Math.hypot(ar[i], ai[i]) + eps;
				ar[i] /= m;
				ai[i] /= m;
			}
		}
		fft(ar, ai, true);
		const out = new Float64Array(La + Lb - 1);
		for (let k = -(Lb - 1); k <= La - 1; k++) out[k + Lb - 1] = ar[(k + n) % n];
		return out;
	}
	var toFloat = (x) => {
		if (x instanceof Float32Array) return x;
		const f = new Float32Array(x.length);
		for (let i = 0; i < x.length; i++) f[i] = x[i] / 32768;
		return f;
	};
	function percentile(v, p) {
		if (!v.length) return 0;
		const s = Float64Array.from(v).sort();
		return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
	}
	function envelope(pcm) {
		const x = toFloat(pcm);
		const nb = Math.floor(x.length / HOP);
		const e = new Float64Array(nb);
		let tot = 0;
		for (let b = 0; b < nb; b++) {
			let s = 0;
			for (let i = b * HOP; i < (b + 1) * HOP; i++) s += x[i] * x[i];
			e[b] = s / HOP;
			tot += s;
		}
		const rms = Math.sqrt(tot / Math.max(1, nb * HOP));
		const env = new Float32Array(nb);
		if (nb < 200) return {
			env,
			usable: false,
			why: "çok kısa (< 2 sn)",
			rms
		};
		if (rms < 1e-4) return {
			env,
			usable: false,
			why: `sessiz (RMS ${(20 * Math.log10(rms + 1e-12)).toFixed(0)} dBFS)`,
			rms
		};
		const floor = Math.max(percentile(e, .2), 1e-10);
		if (percentile(e, .9) < floor * 1.6) return {
			env,
			usable: false,
			why: "ayırt edici ses yok (düz gürültü / ton)",
			rms
		};
		const L = new Float64Array(nb);
		for (let b = 0; b < nb; b++) L[b] = Math.log(e[b] + floor);
		const W = 50;
		const pre = new Float64Array(nb + 1);
		for (let b = 0; b < nb; b++) pre[b + 1] = pre[b] + L[b];
		for (let b = 0; b < nb; b++) {
			const lo = Math.max(0, b - W);
			const hi = Math.min(nb, b + W + 1);
			env[b] = L[b] - (pre[hi] - pre[lo]) / (hi - lo);
		}
		return {
			env,
			usable: true,
			why: "",
			rms
		};
	}
	/**
	* Bütün kaydırmalarda NCC. Yalnız ortak kısmı ≥ minN örnek olan ve [kMin, kMax] içindeki kaydırmalar. Tepeler: en iyi + birbirinden
	* ≥ sep uzak sonrakiler (en çok 4).
	*/
	function nccPeaks(a, b, minN, kMin, kMax, sep) {
		const La = a.length;
		const Lb = b.length;
		if (!La || !Lb) return [];
		const C = xcorr(a, b);
		const pa = new Float64Array(La + 1);
		const pa2 = new Float64Array(La + 1);
		for (let i = 0; i < La; i++) {
			pa[i + 1] = pa[i] + a[i];
			pa2[i + 1] = pa2[i] + a[i] * a[i];
		}
		const pb = new Float64Array(Lb + 1);
		const pb2 = new Float64Array(Lb + 1);
		for (let i = 0; i < Lb; i++) {
			pb[i + 1] = pb[i] + b[i];
			pb2[i + 1] = pb2[i] + b[i] * b[i];
		}
		const lo = Math.max(-(Lb - 1), kMin);
		const hi = Math.min(La - 1, kMax);
		const vals = [];
		const ncc = new Float64Array(Math.max(0, hi - lo + 1)).fill(-2);
		for (let k = lo; k <= hi; k++) {
			const m0 = Math.max(0, k);
			const m1 = Math.min(La, Lb + k);
			const n = m1 - m0;
			if (n < minN) continue;
			const sa = pa[m1] - pa[m0];
			const sa2 = pa2[m1] - pa2[m0];
			const sb = pb[m1 - k] - pb[m0 - k];
			const sb2 = pb2[m1 - k] - pb2[m0 - k];
			const va = sa2 - sa * sa / n;
			const vb = sb2 - sb * sb / n;
			if (va <= 1e-9 * n || vb <= 1e-9 * n) continue;
			ncc[k - lo] = (C[k + Lb - 1] - sa * sb / n) / Math.sqrt(va * vb);
		}
		for (let i = 0; i < ncc.length; i++) {
			const v = ncc[i];
			if (v <= -2) continue;
			if (i > 0 && ncc[i - 1] > v || i + 1 < ncc.length && ncc[i + 1] >= v) continue;
			vals.push({
				k: i + lo,
				ncc: v
			});
		}
		vals.sort((x, y) => y.ncc - x.ncc);
		const out = [];
		for (const v of vals) {
			if (out.some((o) => Math.abs(o.k - v.k) < sep)) continue;
			out.push(v);
			if (out.length >= 4) break;
		}
		return out;
	}
	/**
	* @param K0 kaba kaydırma (örnek, 8 kHz): pos(b) − pos(a)
	* @returns ince kaydırma (örnek, kesirli) ve keskinlik (tepe / ±5 ms dışındaki en büyük) ya da null (ortak bölüm yok)
	*/
	function fineShift(a, b, K0, halfSec, winSec) {
		const La = a.length;
		const Lb = b.length;
		const M = Math.round(halfSec * SR);
		const m0 = Math.max(0, K0);
		const m1 = Math.min(La, Lb + K0);
		if (m1 - m0 < 8e3) return null;
		const W = Math.min(m1 - m0, Math.round(winSec * SR));
		let best = m0;
		if (m1 - m0 > W) {
			const nb = Math.floor((m1 - m0) / HOP);
			const be = new Float64Array(nb + 1);
			for (let i = 0; i < nb; i++) {
				let s = 0;
				for (let j = m0 + i * HOP; j < m0 + (i + 1) * HOP; j++) s += a[j] * a[j];
				be[i + 1] = be[i] + s;
			}
			const wb = Math.floor(W / HOP);
			let bestE = -1;
			for (let i = 0; i + wb <= nb; i++) {
				const s = be[i + wb] - be[i];
				if (s > bestE) {
					bestE = s;
					best = m0 + i * HOP;
				}
			}
		}
		const A = a.subarray(best, best + W);
		const j0 = Math.max(0, best - K0 - M);
		const j1 = Math.min(Lb, best - K0 + W + M);
		if (j1 - j0 < 8e3) return null;
		const B = b.subarray(j0, j1);
		const r = xcorr(A, B, true);
		const off = B.length - 1;
		const kLo = Math.max(-(B.length - 1), K0 - M - best + j0);
		const kHi = Math.min(A.length - 1, K0 + M - best + j0);
		if (kHi < kLo) return null;
		let kb = kLo;
		for (let k = kLo; k <= kHi; k++) if (r[k + off] > r[kb + off]) kb = k;
		const excl = Math.round(.005 * SR);
		let second = 1e-12;
		for (let k = kLo; k <= kHi; k++) if (Math.abs(k - kb) > excl && r[k + off] > second) second = r[k + off];
		let frac = 0;
		if (kb > kLo && kb < kHi) {
			const y0 = r[kb - 1 + off];
			const y1 = r[kb + off];
			const y2 = r[kb + 1 + off];
			const den = y0 - 2 * y1 + y2;
			if (den < 0) frac = Math.max(-.5, Math.min(.5, .5 * (y0 - y2) / den));
		}
		return {
			K: best - j0 + kb + frac,
			sharp: r[kb + off] / second,
			peak: r[kb + off]
		};
	}
	/** Dosya adındaki tarih_saat → saniye (yerel saat, yalnız aynı cihazın dosyaları arasında karşılaştırılır) ya da null. */
	function clockFromName(name) {
		const b = name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
		let m = /(?:^|_)(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_|$)/.exec(b);
		if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1e3;
		m = /^(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_|$)/.exec(b);
		if (m) return Date.UTC(2e3 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1e3;
		return null;
	}
	var median = (v) => {
		const s = v.slice().sort((x, y) => x - y);
		return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
	};
	var cmpOrder = (a, b) => {
		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			const x = a[i] ?? -1;
			const y = b[i] ?? -1;
			if (x !== y) return x < y ? -1 : 1;
		}
		return 0;
	};
	async function solve(files, opts0 = {}, hooks = {}) {
		const o = {
			...DEFAULT_OPTS,
			...opts0
		};
		const yieldNow = hooks.yieldNow ?? (() => new Promise((r) => setTimeout(r, 0)));
		const step = async (text, frac) => {
			if (hooks.cancelled?.()) throw new Cancelled();
			hooks.progress?.(text, frac);
			await yieldNow();
		};
		const notes = [];
		const nodes = [];
		for (let i = 0; i < files.length; i++) {
			await step(`zarf ${i + 1}/${files.length}`, .05 * (i / Math.max(1, files.length)));
			const x0 = toFloat(files[i].pcm);
			let mean = 0;
			for (let k = 0; k < x0.length; k++) mean += x0[k];
			mean /= Math.max(1, x0.length);
			const x = x0 === files[i].pcm || Math.abs(mean) > 1e-6 ? Float32Array.from(x0, (v) => v - mean) : x0;
			nodes.push({
				f: files[i],
				x,
				env: envelope(x),
				dur: x.length / SR
			});
		}
		const n = nodes.length;
		const pairs = [];
		for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
			const A = nodes[i];
			const B = nodes[j];
			if (!A.env.usable || !B.env.usable) continue;
			if (A.f.device === B.f.device && A.f.certain && B.f.certain && A.f.recording !== B.f.recording) continue;
			pairs.push([i, j]);
		}
		const edges = [];
		const match = async (i, j, win) => {
			const A = nodes[i];
			const B = nodes[j];
			const shorter = Math.min(A.env.env.length, B.env.env.length);
			const minN = Math.min(shorter, Math.round(o.minOverlapSec * 100));
			const kMin = win ? Math.floor(win[0] * 100) : -Infinity;
			const kMax = win ? Math.ceil(win[1] * 100) : Infinity;
			const pk = nccPeaks(A.env.env, B.env.env, minN, kMin, kMax, 100).filter((p) => p.ncc >= o.minNcc);
			const lo = Math.max(minN - B.env.env.length, kMin);
			const hi = Math.min(A.env.env.length - minN, kMax);
			const e = {
				a: i,
				b: j,
				peaks: [],
				best: 0,
				bestRatio: 0,
				why: null,
				span: Math.max(0, hi - lo) / 100,
				hinted: !!win
			};
			if (!pk.length) {
				e.why = "ortak bölüm / benzerlik yok";
				return e;
			}
			const cand = [];
			for (const p of pk.slice(0, o.candidates)) {
				await yieldNow();
				const f = fineShift(A.x, B.x, Math.round(p.k / 100 * SR), o.fineHalfSec, o.fineWinSec);
				if (!f) continue;
				const s = f.K / SR;
				cand.push({
					s,
					ncc: p.ncc,
					peak: Math.abs(s - p.k / 100) <= .05 ? f.peak : 0,
					sharp: f.sharp
				});
			}
			cand.sort((x, y) => y.peak - x.peak);
			if (!cand.length || cand[0].peak <= 0) {
				e.why = "ince ayar tutarsız (ortak bölüm yok ya da tepe kabadan uzak)";
				return e;
			}
			e.best = cand[0].peak;
			e.bestRatio = cand[0].peak / Math.max(cand[1]?.peak ?? 0, .02);
			for (let q = 0; q < cand.length; q++) {
				const c = cand[q];
				const ratio = c.peak / Math.max(cand[q + 1]?.peak ?? 0, .02);
				if (c.peak < o.minPeak || c.sharp < o.minSharp || ratio < o.minRatio) {
					if (q === 0) e.why = c.peak < o.minPeak ? `dalga biçimi uyumu düşük (tepe ${c.peak.toFixed(3)} < ${o.minPeak})` : c.sharp < o.minSharp ? `tepe keskin değil (${c.sharp.toFixed(1)} < ${o.minSharp})` : `iki aday yakın (oran ${ratio.toFixed(1)} < ${o.minRatio})`;
					break;
				}
				e.peaks.push({
					s: c.s,
					ncc: c.ncc,
					peak: c.peak,
					ratio,
					sharp: c.sharp
				});
			}
			return e;
		};
		for (let q = 0; q < pairs.length; q++) {
			await step(`eşleştiriliyor ${q + 1}/${pairs.length}`, .1 + .75 * (q / Math.max(1, pairs.length)));
			edges.push(await match(pairs[q][0], pairs[q][1], null));
		}
		await step("çözülüyor", .87);
		const banned = /* @__PURE__ */ new Map();
		const settle = () => {
			let P = place(nodes, edges, o, banned);
			for (let round = 0; round < 6; round++) {
				const more = clockConflicts(nodes, P, o).filter(([i]) => !banned.has(i));
				if (!more.length) break;
				for (const [i, why] of more) banned.set(i, why);
				P = place(nodes, edges, o, banned);
			}
			return P;
		};
		let placement = settle();
		const offs = deviceOffsets(nodes, placement);
		const retry = nodes.map((_, i) => i).filter((i) => placement.group[i] === 0 && !banned.has(i) && !placement.blocked[i] && nodes[i].env.usable && nodes[i].f.clock !== null && offs.has(nodes[i].f.device));
		if (retry.length) {
			let changed = false;
			for (let r = 0; r < retry.length; r++) {
				const i = retry[r];
				const gi = offs.get(nodes[i].f.device);
				const expect = nodes[i].f.clock + gi.offset + lead(nodes[i]);
				for (let j = 0; j < n; j++) {
					if (placement.group[j] !== gi.group || !nodes[j].env.usable) continue;
					if (nodes[i].f.device === nodes[j].f.device && nodes[i].f.certain && nodes[j].f.certain && nodes[i].f.recording !== nodes[j].f.recording) continue;
					await step(`saat ipucuyla yeniden aranıyor ${r + 1}/${retry.length}`, .88 + .08 * (r / retry.length));
					const d = expect - placement.pos[j];
					const [a, b] = i < j ? [i, j] : [j, i];
					const c = i === a ? -d : d;
					const e = await match(a, b, [c - o.hintHalfSec, c + o.hintHalfSec]);
					if (!e.peaks.length) continue;
					const k = edges.findIndex((x) => x.a === a && x.b === b);
					if (k >= 0 && !edges[k].peaks.length) {
						edges[k] = e;
						changed = true;
					} else if (k < 0) {
						edges.push(e);
						changed = true;
					}
				}
			}
			if (changed) {
				placement = settle();
				notes.push(`saat ipucuyla dar pencerede (±${o.hintHalfSec} sn) yeniden arandı: ${retry.length} dosya`);
			}
		}
		if (banned.size) notes.push(`${banned.size} dosya saat ipucuyla çeliştiği için yerleştirilmedi`);
		await step("rapor", .97);
		return report(nodes, edges, placement, o, notes);
	}
	/** PCM başının dosyanın zaman sıfırına göre yeri (sn). */
	var lead = (x) => typeof x.f.lead === "number" && Number.isFinite(x.f.lead) ? x.f.lead : 0;
	/** Konum tahmini: yerleşmiş j'den i'ye kenar e'nin q. tepesi → pos(i). */
	function estimate(e, q, i, posJ) {
		const s = e.peaks[q].s;
		return e.a === i ? posJ - s : posJ + s;
	}
	/** @param banned yerleştirilmeyecek dosyalar (ör. saat ipucuyla çelişen) → gerekçeleriyle "emin değil" */
	function place(nodes, edges, o, banned = /* @__PURE__ */ new Map()) {
		const n = nodes.length;
		const P = {
			group: new Array(n).fill(0),
			pos: new Array(n).fill(0),
			weight: new Array(n).fill(0),
			via: new Array(n).fill(-1),
			viaPeak: new Array(n).fill(null).map(() => ({
				ncc: 0,
				ratio: 0
			})),
			support: new Array(n).fill(0),
			why: new Array(n).fill(""),
			used: /* @__PURE__ */ new Map(),
			blocked: new Array(n).fill(false)
		};
		for (const [i, w] of banned) P.why[i] = w;
		const inc = nodes.map(() => []);
		edges.forEach((e, k) => {
			if (!e.peaks.length || banned.has(e.a) || banned.has(e.b)) return;
			inc[e.a].push(k);
			inc[e.b].push(k);
		});
		const wide = (k) => edges[k].hinted || edges[k].span >= o.wideSec;
		const strength = (i) => inc[i].reduce((s, k) => s + edges[k].peaks[0].peak, 0);
		const violates = (i, p, g) => {
			const fi = nodes[i].f;
			if (!fi.certain) return null;
			for (let j = 0; j < n; j++) {
				if (j === i || P.group[j] !== g) continue;
				const fj = nodes[j].f;
				if (fj.device !== fi.device || !fj.certain) continue;
				if (fj.recording === fi.recording) {
					if (Math.abs(p - P.pos[j]) > o.tolSec) return `aynı kaydın kanalı ${fj.name} ile başlangıç farklı (${((p - P.pos[j]) * 1e3).toFixed(1)} ms)`;
					continue;
				}
				const ov = Math.min(p + nodes[i].dur, P.pos[j] + nodes[j].dur) - Math.max(p, P.pos[j]);
				if (ov >= o.frameSec) return `aynı cihazın ${fj.name} kaydıyla üst üste (${ov.toFixed(3)} sn)`;
				if (fi.order && fj.order) {
					const c = cmpOrder(fi.order, fj.order);
					if (c < 0 && p > P.pos[j] || c > 0 && p < P.pos[j]) return `dosya sırası ${fj.name} ile ters`;
				}
			}
			return null;
		};
		let g = 0;
		for (;;) {
			let root = -1;
			for (let i = 0; i < n; i++) if (P.group[i] === 0 && !P.blocked[i] && inc[i].length && (root < 0 || strength(i) > strength(root))) root = i;
			if (root < 0) break;
			g++;
			P.group[root] = g;
			P.pos[root] = 0;
			P.weight[root] = strength(root);
			P.why[root] = "grubun dayanağı (en çok eşleşen dosya)";
			for (;;) {
				let bestI = -1;
				let bestPos = 0;
				let bestW = 0;
				let bestVia = -1;
				let bestPk = {
					ncc: 0,
					ratio: 0
				};
				let bestSup = 0;
				let bestUsed = [];
				const why = /* @__PURE__ */ new Map();
				for (let i = 0; i < n; i++) {
					if (P.group[i] !== 0 || P.blocked[i] || banned.has(i)) continue;
					const est = [];
					for (const k of inc[i]) {
						const e = edges[k];
						const j = e.a === i ? e.b : e.a;
						if (P.group[j] !== g) continue;
						e.peaks.forEach((pk, q) => est.push({
							p: estimate(e, q, i, P.pos[j]),
							w: pk.peak * (q === 0 ? 1 : .999),
							k,
							q
						}));
					}
					if (!est.length) continue;
					est.sort((x, y) => y.w - x.w);
					const clusters = [];
					for (const x of est) {
						const c = clusters.find((cl) => Math.abs(cl.p - x.p) <= o.tolSec);
						if (c) {
							c.m.push(x);
							c.w += x.w;
						} else clusters.push({
							p: x.p,
							w: x.w,
							m: [x]
						});
					}
					for (const c of clusters) {
						const seen = /* @__PURE__ */ new Set();
						c.m = c.m.filter((x) => seen.has(x.k) ? false : (seen.add(x.k), true));
						c.w = c.m.reduce((s, x) => s + x.w, 0);
						c.p = c.m.reduce((s, x) => s + x.p * x.w, 0) / c.w;
					}
					clusters.sort((x, y) => y.w - x.w);
					let chosen = null;
					let reason = "";
					const okc = clusters.filter((c) => {
						const v = violates(i, c.p, g);
						if (v && !reason) reason = `eşleşme kısıtı bozuyor: ${v}`;
						return !v;
					});
					if (okc.length && !(okc.length > 1 && okc[1].w >= .5 * okc[0].w)) chosen = okc[0];
					else if (okc.length) reason = "çelişen eşleşmeler (iki konum da güçlü)";
					if (chosen && !chosen.m.some((x) => wide(x.k)) && chosen.m.length < 2) {
						reason = "tek ve dar aralıklı eşleşme (kısa klipler; tekrarlayan içerik olabilir) — ikinci bağımsız eşleşme yok";
						chosen = null;
					}
					if (!chosen) {
						why.set(i, reason || "uygun konum yok");
						continue;
					}
					if (chosen.w > bestW) {
						bestI = i;
						bestPos = chosen.p;
						bestW = chosen.w;
						const top = chosen.m[0];
						const e = edges[top.k];
						bestVia = e.a === i ? e.b : e.a;
						bestPk = {
							ncc: e.peaks[top.q].peak,
							ratio: e.peaks[top.q].ratio
						};
						bestSup = chosen.m.length;
						bestUsed = chosen.m.map((x) => [x.k, x.q]);
					}
				}
				if (bestI < 0) {
					for (const [i, w] of why) if (P.group[i] === 0 && !P.why[i]) P.why[i] = w;
					for (let i = 0; i < n; i++) if (P.group[i] === 0 && !P.blocked[i] && inc[i].some((k) => P.group[edges[k].a === i ? edges[k].b : edges[k].a] === g)) {
						P.blocked[i] = true;
						if (!P.why[i]) P.why[i] = "grubun dosyalarıyla eşleşmesi var ama tutarlı bir konum yok";
					}
					break;
				}
				P.group[bestI] = g;
				P.pos[bestI] = bestPos;
				P.weight[bestI] = bestW;
				P.via[bestI] = bestVia;
				P.viaPeak[bestI] = bestPk;
				P.support[bestI] = bestSup;
				P.why[bestI] = "";
				for (const [k, q] of bestUsed) P.used.set(k, q);
			}
		}
		for (let gg = 1; gg <= g; gg++) {
			let min = Infinity;
			for (let i = 0; i < n; i++) if (P.group[i] === gg) min = Math.min(min, P.pos[i]);
			for (let i = 0; i < n; i++) if (P.group[i] === gg) P.pos[i] -= min;
		}
		for (let gg = 1; gg <= g; gg++) {
			const mem = nodes.map((_, i) => i).filter((i) => P.group[i] === gg);
			if (mem.length === 1) {
				const i = mem[0];
				P.group[i] = 0;
				const nb = inc[i].map((k) => edges[k].a === i ? edges[k].b : edges[k].a).find((j) => P.why[j] && !/dayanağı/.test(P.why[j]));
				P.why[i] = nb !== void 0 ? `eşleştiği "${nodes[nb].f.name}" yerleşemedi (${P.why[nb]})` : "hiçbir eşleşmesi yerleşemedi";
			}
		}
		return P;
	}
	/** Dosya başının (zaman sıfırı) grup koordinatındaki yeri. */
	var mpos = (nodes, P, i) => P.pos[i] - lead(nodes[i]);
	function deviceOffsets(nodes, P) {
		const by = /* @__PURE__ */ new Map();
		nodes.forEach((x, i) => {
			if (P.group[i] === 0 || x.f.clock === null) return;
			by.set(x.f.device, [...by.get(x.f.device) ?? [], {
				g: P.group[i],
				v: mpos(nodes, P, i) - x.f.clock
			}]);
		});
		const out = /* @__PURE__ */ new Map();
		for (const [d, list] of by) {
			const cnt = /* @__PURE__ */ new Map();
			for (const x of list) cnt.set(x.g, (cnt.get(x.g) ?? 0) + 1);
			const g = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
			const v = list.filter((x) => x.g === g).map((x) => x.v);
			const m = median(v);
			out.set(d, {
				offset: m,
				group: g,
				n: v.length,
				spread: median(v.map((x) => Math.abs(x - m)))
			});
		}
		return out;
	}
	/**
	* Saat ipucuyla çelişen yerleşimler (inceleme #15 B4): kimliği KESİN cihazın (tek saat) aynı gruptaki ≥ 3 saatli dosyası aynı kaymada
	* tutarlıysa (medyan mutlak sapma ≤ 2 sn), saatine > clockTolSec uymayan dosya — aynı içerik başka zamanda da çalmış olabilir.
	*/
	function clockConflicts(nodes, P, o) {
		const out = [];
		const by = /* @__PURE__ */ new Map();
		nodes.forEach((x, i) => {
			if (P.group[i] === 0 || x.f.clock === null || !x.f.certain) return;
			const k = `${P.group[i]}\u0000${x.f.device}`;
			by.set(k, [...by.get(k) ?? [], i]);
		});
		for (const list of by.values()) {
			if (list.length < 3) continue;
			const v = list.map((i) => mpos(nodes, P, i) - nodes[i].f.clock);
			const m = median(v);
			if (median(v.map((x) => Math.abs(x - m))) > 2) continue;
			list.forEach((i, k) => {
				if (Math.abs(v[k] - m) > o.clockTolSec) out.push([i, `saat ipucuyla ${(v[k] - m).toFixed(1)} sn çelişiyor (aynı cihazın ${list.length - 1} dosyası saatine uyuyor; aynı ses başka zamanda da çalmış olabilir)`]);
			});
		}
		return out;
	}
	function report(nodes, edges, P, o, notes) {
		const G = Math.max(0, ...P.group);
		const shift = /* @__PURE__ */ new Map();
		for (let g = 1; g <= G; g++) {
			let m = Infinity;
			nodes.forEach((_, i) => P.group[i] === g && (m = Math.min(m, mpos(nodes, P, i))));
			if (m !== Infinity) shift.set(g, m);
		}
		const rpos = (i) => mpos(nodes, P, i) - (shift.get(P.group[i]) ?? 0);
		const offs = deviceOffsets(nodes, P);
		const groups = [];
		for (let g = 1; g <= G; g++) {
			const mem = nodes.map((_, i) => i).filter((i) => P.group[i] === g);
			if (!mem.length) continue;
			groups.push({
				n: groups.length + 1,
				ids: mem.map((i) => nodes[i].f.id),
				start: Math.min(...mem.map((i) => rpos(i))),
				end: Math.max(...mem.map((i) => rpos(i) + nodes[i].dur)),
				clockFrom1: null
			});
		}
		const renum = /* @__PURE__ */ new Map();
		{
			let k = 0;
			for (let g = 1; g <= G; g++) if (nodes.some((_, i) => P.group[i] === g)) renum.set(g, ++k);
		}
		if (groups.length > 1) {
			const anchor = /* @__PURE__ */ new Map();
			for (let g = 1; g <= G; g++) {
				const m = /* @__PURE__ */ new Map();
				nodes.forEach((x, i) => {
					if (P.group[i] === g && x.f.clock !== null) m.set(x.f.device, [...m.get(x.f.device) ?? [], x.f.clock - rpos(i)]);
				});
				const mm = /* @__PURE__ */ new Map();
				for (const [d, v] of m) mm.set(d, median(v));
				anchor.set(renum.get(g) ?? 0, mm);
			}
			const a1 = anchor.get(1);
			for (const gr of groups) {
				if (gr.n === 1) {
					gr.clockFrom1 = 0;
					continue;
				}
				const ag = anchor.get(gr.n);
				const diffs = [];
				for (const [d, v] of ag) if (a1.has(d)) diffs.push(v - a1.get(d));
				gr.clockFrom1 = diffs.length ? median(diffs) : null;
			}
		}
		const placed = nodes.map((x, i) => {
			const g = P.group[i];
			const off = offs.get(x.f.device);
			const hintPos = g && off && off.group === g && x.f.clock !== null ? x.f.clock + off.offset - (shift.get(g) ?? 0) : null;
			return {
				id: x.f.id,
				name: x.f.name,
				status: g ? "ok" : "emin değil",
				group: g ? renum.get(g) ?? 0 : 0,
				pos: g ? rpos(i) : null,
				confidence: g ? Math.min(1, P.weight[i]) : 0,
				via: P.via[i] >= 0 ? nodes[P.via[i]].f.name : null,
				viaPeak: P.viaPeak[i].ncc,
				viaRatio: P.viaPeak[i].ratio,
				support: P.support[i],
				hintPos,
				hintDiff: hintPos !== null && g ? rpos(i) - hintPos : null,
				why: g ? P.why[i] : !x.env.usable ? x.env.why : P.why[i] || bestWhy(i, edges) || "eşleşme yok"
			};
		});
		const outEdges = edges.map((e, k) => {
			const q = P.used.get(k);
			const s = e.peaks.length ? e.peaks[q ?? 0].s : null;
			let residualMs = null;
			if (s !== null && P.group[e.a] && P.group[e.a] === P.group[e.b]) residualMs = (P.pos[e.b] - P.pos[e.a] - s) * 1e3;
			return {
				a: nodes[e.a].f.name,
				b: nodes[e.b].f.name,
				s,
				peak: e.best,
				ratio: e.bestRatio,
				used: q !== void 0,
				residualMs,
				why: e.why
			};
		});
		const bad = outEdges.filter((e, k) => e.residualMs !== null && Math.abs(e.residualMs) > o.tolSec * 1e3 && edges[k].peaks.length > 0);
		if (bad.length) notes.push(`${bad.length} güvenli eşleşme sonuçla ±${(o.tolSec * 1e3).toFixed(0)} ms'den fazla ayrışıyor (kullanılmadı; rapor listesinde)`);
		return {
			placed,
			groups,
			edges: outEdges,
			deviceClock: [...offs.entries()].map(([device, v]) => ({
				device,
				offset: v.offset,
				n: v.n,
				spread: v.spread
			})),
			notes
		};
	}
	function bestWhy(i, edges) {
		const mine = edges.filter((e) => e.a === i || e.b === i);
		if (!mine.length) return "eşleştirilecek dosya yok (aynı cihaz / sessiz)";
		const top = mine.slice().sort((x, y) => y.best - x.best)[0];
		return `güvenli eşleşme yok (en iyi aday: tepe ${top.best.toFixed(3)}, oran ${top.bestRatio.toFixed(1)}${top.why ? " — " + top.why : ""})`;
	}
	//#endregion
	exports.CORE_VERSION = "1.1.0";
	exports.SENKRON_OPTS = DEFAULT_OPTS;
	exports.channelOutliers = channelOutliers;
	exports.channelTypeName = channelTypeName;
	exports.classify = classify;
	exports.compareLinkGroups = compareLinkGroups;
	exports.groupsFromLayout = groupsFromLayout;
	exports.layoutGroupItems = layoutGroupItems;
	exports.linkItemKey = linkItemKey;
	exports.linkItemOf = linkItemOf;
	exports.reduceToPresent = reduceToPresent;
	exports.senkronClock = clockFromName;
	exports.senkronSolve = solve;
	return exports;
})({});
