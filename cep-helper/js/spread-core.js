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
	*  - "sil" track'inde klip → HATA (KES silmemiş).
	*  - kamera sesi: videosuyla aynı kaynak + aynı start/end → grubunda harici ses YOKSA grubun (korunan kamera sesi), VARSA HATA (KES
	*    kılavuzu silmemiş). Videosuyla aynı yerde olmayan kamera sesi: harici sesli bir grubun çapasına değiyorsa HATA, değilse dokunulmaz.
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
			if (sil.has(c.track)) {
				errors.push(`${at(c)}: "sil" kaynağının track'inde — KES silmemiş`);
				continue;
			}
			const g = groups.find((q) => inside(c, q));
			if (g) g.audio.push(c);
			else if (mainCams.some((v) => touches(c, v))) errors.push(`${at(c)}: hiçbir çapanın içinde değil ama bir kameraya değiyor — KES yapılmamış ya da düzen değişmiş`);
			else ignored.push(`${at(c)}: hiçbir kameraya değmiyor (kamerasız oturum) — dokunulmaz`);
		}
		const hasExt = new Set(groups.filter((g) => g.audio.length).map((g) => g.anchor));
		for (const x of items.filter((i) => i.role === "guide" && i.clip.track < frame.aPark)) {
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
	//#endregion
	exports.CORE_VERSION = "0.3.2";
	exports.classify = classify;
	exports.compareLinkGroups = compareLinkGroups;
	exports.groupsFromLayout = groupsFromLayout;
	exports.layoutGroupItems = layoutGroupItems;
	exports.linkItemKey = linkItemKey;
	return exports;
})({});
