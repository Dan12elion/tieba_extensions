/**
 * 用真实页面快照（MHTML）做离线回归测试。
 *
 * 把保存下来的贴吧页面解码成 HTML，注入本工程的脚本，在无头浏览器里
 * 检查按钮注入情况。这能覆盖「旧版页面不出按钮」这类只有真实 DOM 才暴露的问题。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractHtml } from "./extract-mhtml.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const bundlePath =
	process.env.EZTB_BUNDLE ??
	path.join(projectRoot, "dist/tieba-eztb-toolbox.user.js");
const bundle = fs.readFileSync(bundlePath, "utf8");

/** 快照目录：默认取与本项目同级的 `../test0`，可用 EZTB_SAMPLE_DIR 覆盖 */
const SAMPLE_DIR =
	process.env.EZTB_SAMPLE_DIR ?? path.resolve(projectRoot, "..", "test0");

/**
 * 快照的样式表缓存目录。
 *
 * MHTML 不保存 `<style>`，页面保存下来是"裸 DOM"——按它测布局会得出错误结论
 * （真实页面上按钮压住内容的问题就是这么藏住的）。所以把快照里引用的
 * CSS 单独抓一份存这里，测试时用本地路由喂回去，快照就变成带样式的页面了。
 */
const CSS_DIR = process.env.EZTB_CSS_DIR ?? path.join(SAMPLE_DIR, "_css_cache");

/**
 * 快照可能放在两处：
 *   1. 外部快照目录（默认同级 `../test0`，可用 EZTB_SAMPLE_DIR 指定）
 *   2. 本项目里的 dist/.samples（方便随手把一份页面另存进来，该目录被 .gitignore 忽略）
 *   3. 本项目根目录（用户直接另存到仓库里时就在这儿，同样被 .gitignore 忽略）
 */
const SAMPLE_DIRS = [
	SAMPLE_DIR,
	path.join(projectRoot, "dist/.samples"),
	projectRoot,
];

/**
 * 「网页，完整」格式的快照：`<标题>.html` + `<标题>_files/` 资源目录。
 *
 * 和 MHTML 相比，这种保存方式**带着外部 CSS**（贴吧的 `pb.*.css` 就在里面），
 * 所以布局类断言在这类快照上是准的——MHTML 那边只能靠 fetch-sample-css.mjs 补齐（见 §5 #15）。
 */
function loadSavedPage(htmlPath) {
	const base = htmlPath.replace(/\.html?$/i, "");
	const filesDir = `${base}_files`;
	if (!fs.existsSync(filesDir)) return null;
	const folder = path.basename(filesDir);
	/**
	 * **不要**改写 HTML 里的相对路径。

	 * 之前把 `<标题>_files/` 换成 `/files/`，结果 `./<标题>_files/x.css` 变成 `.//files/x.css`，
	 * 浏览器按"协议相对 URL"解析 → 每个外部 CSS 都 404 → 页面变成无样式，
	 * 布局断言又一次测在裸 DOM 上（HANDOFF §5 #15 的坑，换个形式又踩了一遍）。
	 * 现在原样保留，按原目录名提供文件：页面 URL 是 `/`，相对引用自然落到 `/<标题>_files/…`。
	 */
	const html = fs.readFileSync(htmlPath, "utf8");
	/**
	 * 剥掉页面自己的脚本。

	 * 「网页，完整」另存时 JS 会被存成 `xxx.js.下载`，离线根本取不到；
	 * 页面里残留的内联脚本（Vue 运行时的那一段）于是会在 `_typeof is not defined`
	 * 这类地方抛错，把"运行期无 JS 错误"这条断言染红——那不是我们的问题。
	 * 这个测试只看「我们的脚本在真实 DOM + 真实 CSS 上的表现」，页面自己的 JS 不需要，
	 * 而且它一旦真跑起来还会去请求网络、改写 DOM，反而让结果不可复现。
	 */
	const withoutPageScripts = html.replace(
		/<script\b[^>]*>[\s\S]*?<\/script>/gi,
		"<!-- page script removed by page-test -->",
	);
	/**
	 * 再剥掉**我们自己**上一次注入留下的东西。

	 * 用户保存页面时脚本正在运行，所以快照里已经有按钮、`data-tb-eztb-toolbox-done` 标记、
	 * 成分标记以及**当时那一版**的 `<style>`。不剥掉的话：
	 *   1. "按钮数达标"会靠旧按钮蒙混过关（扫描器看见标记就跳过，根本不注入）；
	 *   2. 布局断言量的是旧版 CSS，而不是本次构建的产物。
	 * 剥干净之后，页面是"原样 DOM + 原样 CSS"，注入与排版都由被测的那份产物决定。
	 */
	const withoutOurArtifacts = withoutPageScripts
		// 我们注入的 <style>（含 tb-eztb 的那个块）
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) =>
			block.includes("tb-eztb") ? "<!-- eztb style removed -->" : block,
		)
		// 注入的按钮
		.replace(
			/<button\b[^>]*class="[^"]*tb-eztb-btn[^"]*"[^>]*>[\s\S]*?<\/button>/gi,
			"",
		)
		// 标记属性
		.replace(/\sdata-tb-eztb-toolbox-done(="[^"]*")?/gi, "");
	return {
		html: stripEztbBadges(withoutOurArtifacts),
		filesDir,
		prefixes: [`/${encodeURIComponent(folder)}/`, `/${folder}/`],
	};
}

/**
 * 剥掉成分标记（`.tb-eztb-badges` 里还嵌着若干 `<span>`，正则的非贪婪匹配会只吃掉一半，
 * 所以手动配对到它自己的闭合标签）。
 */
function stripEztbBadges(html) {
	let out = html;
	for (let guard = 0; guard < 50; guard += 1) {
		const marker = out.indexOf("tb-eztb-badges");
		if (marker < 0) break;
		const open = out.lastIndexOf("<span", marker);
		if (open < 0) break;
		let depth = 0;
		let cursor = open;
		let end = -1;
		while (cursor < out.length) {
			const nextOpen = out.indexOf("<span", cursor);
			const nextClose = out.indexOf("</span>", cursor);
			if (nextClose < 0) break;
			if (nextOpen >= 0 && nextOpen < nextClose) {
				depth += 1;
				cursor = nextOpen + 5;
				continue;
			}
			depth -= 1;
			cursor = nextClose + 7;
			if (depth <= 0) {
				end = cursor;
				break;
			}
		}
		if (end < 0) break;
		out = out.slice(0, open) + out.slice(end);
	}
	return out;
}

const MIME_BY_EXT = {
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
};

/** 按名字找快照；绝对路径直接用。找不到返回 null。 */
function resolveSample(file) {
	if (path.isAbsolute(file)) return fs.existsSync(file) ? file : null;
	for (const dir of SAMPLE_DIRS) {
		const candidate = path.join(dir, file);
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}
if (!fs.existsSync(CSS_DIR)) {
	console.warn(
		`提示：没有找到样式缓存 ${CSS_DIR}，快照将以"无样式"渲染，布局类断言会失真。\n` +
			"      先跑一次 node scripts/fetch-sample-css.mjs 把快照引用的 CSS 抓下来。",
	);
}

const SAMPLES = [
	{
		name: "旧版帖子页（用户报告无按钮）",
		// 这份快照是用户手动另存的，默认在 SAMPLE_DIR 里找同名文件；
		// 放在别处时用 EZTB_SAMPLE_DESKTOP 指定绝对路径。
		file:
			process.env.EZTB_SAMPLE_DESKTOP ??
			"没玩过原神不懂就问【有男不玩ml吧】_百度贴吧.mhtml",
		expect: { minButtons: 6, selector: ".l_post" },
	},
	{
		name: "旧版帖子页",
		file: "典中典之豆包。【有男不玩ml吧】_百度贴吧.mhtml",
		expect: { minButtons: 5, selector: ".l_post" },
	},
	{
		name: "新版帖子页",
		file: "典中典之豆包。-百度贴吧.mhtml",
		expect: { minButtons: 5, selector: ".head-line" },
	},
	{
		name: "新版用户主页",
		file: "牢婴儿-百度贴吧.mhtml",
		expect: { minButtons: 0, selector: ".head-line" },
	},
	{
		// 用户 2026-09-27 直接另存到仓库根目录的那份（「网页，完整」格式，**自带外部 CSS**）
		name: "新版帖子页（网页完整保存，带 pb.css）",
		file:
			process.env.EZTB_SAMPLE_SAVED ??
			"女频文娱作品里，道德是一种资产-百度贴吧.html",
		expect: { minButtons: 5, selector: ".head-line" },
	},
	{
		// 同一份快照再跑一次，但把内容容器压窄到 420px：这才是"窗口窄 / 昵称长"的真实情形。
		// 手工去改 .head-info 宽度是造出来的场景（页面自己的固定宽度元素会先顶出去），
		// 测出来的不是我们的问题。
		name: "新版帖子页（窄容器 420px）",
		file:
			process.env.EZTB_SAMPLE_SAVED ??
			"女频文娱作品里，道德是一种资产-百度贴吧.html",
		narrow: true,
		expect: { minButtons: 5, selector: ".head-line" },
	},
];

const BROWSERS = [
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const browser = BROWSERS.find((candidate) => fs.existsSync(candidate));
if (!browser) {
	console.error("找不到 Edge 或 Chrome");
	process.exit(1);
}

const GM_STUB = `
var __store = { tbEztbToolboxSettingsV1: { bduss: 'TEST_DUMMY_BDUSS' } };
window.GM_getValue = function (k, d) { return (k in __store) ? __store[k] : d; };
window.GM_setValue = function (k, v) { __store[k] = v; };
window.GM_registerMenuCommand = function () { return 1; };
window.GM_xmlhttpRequest = function () { return { abort: function () {} }; };
window.__tbErrors = [];
window.addEventListener('error', function (e) { window.__tbErrors.push(String(e.message)); });
// 捕获脚本自身的 console 输出：scan() 会把处理器异常降级成 console.warn
window.__tbLogs = [];
['log', 'warn', 'error'].forEach(function (level) {
  var original = console[level];
  console[level] = function () {
    var parts = Array.prototype.map.call(arguments, function (arg) {
      if (arg && arg.stack) return String(arg.stack).split('\\n').slice(0, 3).join(' | ');
      return String(arg);
    });
    window.__tbLogs.push(level + ': ' + parts.join(' ').slice(0, 400));
    if (original) { try { original.apply(console, arguments); } catch (e) {} }
  };
});
`;

const DRIVER = `
window.__cssProbe = null;
fetch('/files/pb.d2d352c2.css')
  .then(function (r) { return r.text().then(function (t) { window.__cssProbe = { status: r.status, len: t.length, head: t.slice(0, 40) }; }); })
  .catch(function (e) { window.__cssProbe = { error: String(e) }; });
function count(sel) { return document.querySelectorAll(sel).length; }
function report() {
  var lines = [];
  function add(label, ok, detail) {
    lines.push((ok ? 'PASS' : 'FAIL') + '|' + label + '|' + (detail === undefined ? '' : String(detail)));
  }
  var buttons = count('.tb-eztb-btn');
  var done = count('[data-tb-eztb-toolbox-done]');
  add('扫描器处理过的元素数 > 0', done > 0, done);
  add('未与旧脚本共用标记属性', true,
      '本脚本标记=' + done + ' 旧脚本标记=' + count('[data-tb-eztb-done]'));
  add('按钮数达到预期', buttons >= __MIN_BUTTONS, '按钮 ' + buttons + ' 个 / 期望 ≥ ' + __MIN_BUTTONS);
  add('处理过的元素都有对应按钮', done === 0 || buttons > 0,
      'done=' + done + ' buttons=' + buttons);
  // 默认不带关键词规则：不该注入任何成分标记，也不该因此产生请求或报错
  add('没有配置关键词规则时不注入成分标记', count('.tb-eztb-badges') === 0,
      '标记组 ' + count('.tb-eztb-badges') + ' 个');
  add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; ').slice(0, 120));

  var eztbLogs = window.__tbLogs.filter(function (l) { return l.indexOf('[eztb]') >= 0; });
  var errorLogs = eztbLogs.filter(function (l) { return l.indexOf('失败') >= 0; });
  add('脚本无异常日志', errorLogs.length === 0, errorLogs.slice(0, 2).join(' || '));

  // 复刻取数逻辑，定位为什么没有插按钮
  var first = document.querySelector('.p_author_name');
  if (first) {
    var rawField = first.getAttribute('data-field') || '';
    var parsed = 'null';
    try {
      parsed = JSON.stringify(JSON.parse(rawField.replace(/'/g, '"')));
    } catch (e) {
      parsed = 'PARSE_ERROR(' + e.message + ') raw=' + rawField.slice(0, 80);
    }
    add('诊断-作者元素 data-field 解析', parsed.indexOf('PARSE_ERROR') < 0, parsed.slice(0, 120));
    add('诊断-父节点', true,
        first.parentNode ? (first.parentNode.tagName + '.' + (first.parentNode.className || '')) : 'null');
    add('诊断-在 .l_post 内', !!first.closest('.l_post'), '');
    var probe = document.createElement('button');
    probe.className = 'tb-eztb-probe';
    if (first.parentNode) first.parentNode.insertBefore(probe, first.nextSibling);
    add('诊断-手动插入兄弟节点', !!document.querySelector('.tb-eztb-probe'), '');
  }

  // 注入 ≠ 用户看得见，这里验证尺寸、计算样式与命中
  var btn = document.querySelector('.tb-eztb-btn');
  if (btn) {
    btn.scrollIntoView({ block: 'center' });
    var r = btn.getBoundingClientRect();
    var cs = getComputedStyle(btn);
    add('按钮有实际尺寸', r.width > 0 && r.height > 0,
        'w=' + r.width.toFixed(1) + ' h=' + r.height.toFixed(1));
    add('按钮计算样式可见',
        cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0,
        cs.display + ' / ' + cs.visibility + ' / opacity=' + cs.opacity);
    var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    add('按钮可被点中', hit === btn || btn.contains(hit),
        hit ? (hit.tagName + ':' + (hit.className || '')) : 'null');
    add('按钮水平位置合理', r.left >= 0 && r.left < window.innerWidth,
        'left=' + r.left.toFixed(1));
  }

  // 诊断信息：各选择器在真实 DOM 里的命中数
  var diag = ['.l_post', '.p_author_name', '.d_author', 'a.frs-author-name',
              '.head-line', '.lzl_cnt > .at', '.head-name'].map(function (s) {
    return s + '=' + count(s);
  }).join(' ');
  add('诊断', true, diag);

  // 布局诊断（EZTB_LAYOUT_PROBE=1 时输出）：按钮矩形，以及被它压住/压住它的元素
  // 新版页面的头部行是固定高度的（.image-text .user-info{height:40px}），
  // 我们塞进去的按钮 / 成分标记必须待在这一行里，否则会盖住下面的标题与正文。
  var headRow = document.querySelector('.head-line');
  if (headRow) {
    var rowBtn = headRow.querySelector('.tb-eztb-btn');
    if (rowBtn) {
      // 造 3 个标记（模拟命中 3 条规则）后再量，标记越多越容易把行撑高
      var cluster = document.createElement('span');
      cluster.className = 'tb-eztb-badges';
      for (var k = 0; k < 3; k++) {
        var chip = document.createElement('span');
        chip.className = 'tb-eztb-badge';
        // 用长一点的规则名：短名字在宽行里不会折行，测不出真问题
        chip.textContent = '🎮崩坏星穹铁道';
        cluster.appendChild(chip);
      }
      rowBtn.insertAdjacentElement('afterend', cluster);
      var rowRect = headRow.getBoundingClientRect();
      var btnRect = rowBtn.getBoundingClientRect();
      var clRect = cluster.getBoundingClientRect();
      add('新版：「查询」按钮待在头部行的高度内', 
          btnRect.top >= rowRect.top - 1 && btnRect.bottom <= rowRect.bottom + 1,
          '行=[' + rowRect.top.toFixed(1) + ',' + rowRect.bottom.toFixed(1) + '] 按钮=[' + btnRect.top.toFixed(1) + ',' + btnRect.bottom.toFixed(1) + ']');
      add('新版：成分标记待在头部行的高度内（不会压住下面的正文）',
          clRect.top >= rowRect.top - 1 && clRect.bottom <= rowRect.bottom + 1,
          '行=[' + rowRect.top.toFixed(1) + ',' + rowRect.bottom.toFixed(1) + '] 标记=[' + clRect.top.toFixed(1) + ',' + clRect.bottom.toFixed(1) + ']');
      add('新版：成分标记没有顶出行的右边界',
          clRect.right <= rowRect.right + 1,
          '标记 right=' + clRect.right.toFixed(1) + ' 行 right=' + rowRect.right.toFixed(1));
      cluster.remove();

      /**
       * 用户报过的问题：**「查询」按钮有时部分遮挡楼层正文**。
       *
       * 判据不是"包围盒相交"，而是"把我们的按钮藏起来，再在同一个点上取一次命中"——
       * 藏起来之后命中的那个元素，就是被我们压住的东西。
       * 实测（2026-09-27 用户快照）：回复行的正文块会往上顶到头部行的下半部分，
       * 而按钮默认在这行里垂直居中，于是 20/23 行都压着正文。
       */
      var covering = [];
      Array.prototype.forEach.call(document.querySelectorAll('.head-line'), function (row, rowIndex) {
        var rowBtns = Array.prototype.slice.call(row.querySelectorAll('.tb-eztb-btn'));
        if (!rowBtns.length) return;
        row.scrollIntoView({ block: 'center' });
        var br0 = rowBtns[0].getBoundingClientRect();
        var points = [
          [br0.left + 3, br0.top + 3],
          [br0.left + br0.width / 2, br0.top + br0.height / 2],
          [br0.right - 3, br0.bottom - 3]
        ];
        // 脚本自己的 CSS 里写了 visibility:visible !important，隐藏时必须带 important
        var saved = rowBtns.map(function (b) { return b.style.getPropertyValue('visibility'); });
        rowBtns.forEach(function (b) { b.style.setProperty('visibility', 'hidden', 'important'); });
        var hits = points.map(function (p) {
          var el = document.elementFromPoint(p[0], p[1]);
          return el ? (el.tagName + '.' + String(el.className || '').slice(0, 30)) : 'null';
        });
        rowBtns.forEach(function (b, i) {
          if (saved[i]) b.style.setProperty('visibility', saved[i]);
          else b.style.removeProperty('visibility');
        });
        var covered = hits.filter(function (hit) {
          return hit !== 'null' &&
            hit.indexOf('DIV.btn-wrapper') < 0 &&
            hit.indexOf('DIV.head-line') < 0 &&
            hit.indexOf('BODY') < 0 &&
            hit.indexOf('HTML') < 0;
        });
        if (covered.length) {
          covering.push({ 行: rowIndex, 盖住了: covered, 命中: hits });
        }
      });
      add('「查询」按钮没有盖住任何页面内容（逐行验证：藏起来再取同一点）',
          covering.length === 0,
          covering.length ? JSON.stringify(covering.slice(0, 3)) :
            '23 行内都没有压住别的元素');

      // 再把头部行压窄（模拟"昵称很长 / 窗口很窄"）：新版头部行高度写死 40px，
      // 标记一折行就会顶到下面的标题与正文上——这两个断言就是钉住这一点。
      // 做法是让"名字/时间"那一块吃掉几乎整行宽度（真实情况：昵称长、还带等级标签与 IP 属地），
      // 而不是硬压行宽——硬压会让页面自己的固定宽度元素先顶出去，测出来的不是我们的问题。
      // 注意：窄容器那一次运行（__NARROW）本身就是挤压场景，不再手工改宽度。
      if (!window.__NARROW) {
        var headInfo = headRow.querySelector('.head-info');
        var saveInfoWidth = headInfo ? headInfo.style.width : null;
        if (headInfo) {
          headInfo.style.width = Math.max(120, rowRect.width - 110) + 'px';
        }
        var tightRowRect = headRow.getBoundingClientRect();
        // 先量"没有我们的标记时"这一行会不会被撑宽：强行改 .head-info 宽度本身就可能让
        // 页面自己的固定宽度元素先顶出去，那种溢出不是我们的锅。我们只该保证"不额外撑宽"。
        var scrollBefore = headRow.scrollWidth;
        var tightCluster = document.createElement('span');
        tightCluster.className = 'tb-eztb-badges';
        for (var t = 0; t < 3; t++) {
          var tightChip = document.createElement('span');
          tightChip.className = 'tb-eztb-badge';
          tightChip.textContent = '🎮崩坏星穹铁道';
          tightCluster.appendChild(tightChip);
        }
        rowBtn.insertAdjacentElement('afterend', tightCluster);
        var tightRect = tightCluster.getBoundingClientRect();
        add('新版：行被挤窄时成分标记不折行（不会压住下面的正文）',
            tightRect.height <= tightRowRect.height + 1 && tightRect.bottom <= tightRowRect.bottom + 1,
            '行高=' + tightRowRect.height.toFixed(1) + ' 标记高=' + tightRect.height.toFixed(1) +
            ' 越界=' + (tightRect.bottom - tightRowRect.bottom).toFixed(1) + 'px');
        add('新版：行被挤窄时成分标记不顶出行右边界',
            headRow.scrollWidth <= scrollBefore + 1,
            '标记 right=' + tightRect.right.toFixed(1) + ' 行 right=' + tightRowRect.right.toFixed(1) +
            ' scrollWidth=' + scrollBefore + ' → ' + headRow.scrollWidth +
            ' clientWidth=' + headRow.clientWidth);
        tightCluster.remove();
        if (headInfo && saveInfoWidth !== null) headInfo.style.width = saveInfoWidth;
      }
    }
  }

  if (__LAYOUT_PROBE) {
    add('布局诊断-样式表自检（浏览器里取一次）', true, JSON.stringify(window.__cssProbe || 'still pending'));
    add('布局诊断-样式表 link 状态', true, JSON.stringify(
      Array.prototype.map.call(document.querySelectorAll('link[rel~="stylesheet"]'), function (link) {
        return {
          href: String(link.getAttribute('href') || '').slice(0, 60),
          有sheet: !!link.sheet,
          disabled: link.sheet ? link.sheet.disabled : null,
          规则: link.sheet ? (function () { try { return link.sheet.cssRules.length; } catch (e) { return 'ERR'; } })() : null
        };
      })
    ));
    add('布局诊断-资源加载记录', true, JSON.stringify(
      performance.getEntriesByType('resource')
        .filter(function (e) { return e.name.indexOf('.css') >= 0; })
        .map(function (e) {
          return e.name.split('/').pop() + ' status=' + (e.responseStatus || '?') +
            ' size=' + (e.transferSize || 0) + ' dur=' + Math.round(e.duration);
        })
    ));
    // 逐行量：头部行的可用余量、3 个标记会不会折行（折行就会顶到下面的正文）
    var rowsInfo = [];
    Array.prototype.forEach.call(document.querySelectorAll('.head-line'), function (row) {
      var rowBtn = row.querySelector('.tb-eztb-btn');
      if (!rowBtn) return;
      var probe = document.createElement('span');
      probe.className = 'tb-eztb-badges';
      for (var k = 0; k < 3; k++) {
        var chip = document.createElement('span');
        chip.className = 'tb-eztb-badge';
        chip.textContent = '🎮崩坏星穹铁道';
        probe.appendChild(chip);
      }
      rowBtn.insertAdjacentElement('afterend', probe);
      var rr = row.getBoundingClientRect();
      var pr = probe.getBoundingClientRect();
      rowsInfo.push({
        rowW: Math.round(rr.width),
        slackAfterButton: Math.round(rr.right - rowBtn.getBoundingClientRect().right),
        clusterW: Math.round(pr.width),
        clusterH: Math.round(pr.height),
        overflowBottom: Math.round(pr.bottom - rr.bottom)
      });
      probe.remove();
    });
    add('布局诊断-各行余量与标记尺寸', true, JSON.stringify(rowsInfo.slice(0, 4)) +
        ' 共 ' + rowsInfo.length + ' 行');

    add('布局诊断-样式表', true,
        'styleSheets=' + document.styleSheets.length +
        ' 首条=' + String((document.styleSheets[1] || {}).href || '(无)') +
        ' head-line.display=' + String((document.querySelector('.head-line') ? getComputedStyle(document.querySelector('.head-line')).display : 'n/a')));
    var probeBtn = document.querySelector('.tb-eztb-btn');
    if (probeBtn) {
      var br = probeBtn.getBoundingClientRect();
      var overlaps = [];
      Array.prototype.forEach.call(document.querySelectorAll('body *'), function (el) {
        if (el === probeBtn || probeBtn.contains(el) || el.contains(probeBtn)) return;
        var r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var w = Math.min(br.right, r.right) - Math.max(br.left, r.left);
        var h = Math.min(br.bottom, r.bottom) - Math.max(br.top, r.top);
        if (w > 0.5 && h > 0.5) {
          overlaps.push({
            el: el.tagName + '.' + String(el.className || '').slice(0, 40),
            area: Math.round(w * h),
            text: String(el.textContent || '').replace(/\s+/g, ' ').slice(0, 40)
          });
        }
      });
      overlaps.sort(function (a, b) { return b.area - a.area; });
    add('布局诊断-按钮矩形', true,
        'left=' + Math.round(br.left) + ' top=' + Math.round(br.top) +
        ' w=' + Math.round(br.width) + ' h=' + Math.round(br.height));
    add('布局诊断-与按钮重叠的元素', true, JSON.stringify(overlaps.slice(0, 6)));

    /**
     * 逐行看：我们的按钮/标记盖住了同一行里的哪些**页面元素**。
     * 判据是"点它中心时命中的是不是我们自己的元素"——这才是用户眼里的"被遮挡"，
     * 光看包围盒相交会把"并排但没盖住"也算进去。
     */
    var coveredReport = [];
    Array.prototype.forEach.call(document.querySelectorAll('.head-line'), function (row, index) {
      if (index > 5) return;
      var ours = row.querySelector('.tb-eztb-btn');
      if (!ours) return;
      var wrapper = ours.closest('.btn-wrapper');
      var wcs = wrapper ? getComputedStyle(wrapper) : null;
      var covered = [];
      Array.prototype.forEach.call(row.querySelectorAll('*'), function (el) {
        if (ours.contains(el) || el.contains(ours)) return;
        if (el.classList.contains('tb-eztb-badges') || el.classList.contains('tb-eztb-badge')) return;
        var r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit === ours || ours.contains(hit)) {
          covered.push({
            el: el.tagName + '.' + String(el.className || '').slice(0, 34),
            text: String(el.textContent || '').replace(/\\s+/g, ' ').slice(0, 24),
            w: Math.round(r.width),
            h: Math.round(r.height)
          });
        }
      });
      var rowR = row.getBoundingClientRect();
      var ourR = ours.getBoundingClientRect();
      coveredReport.push({
        row: [Math.round(rowR.left), Math.round(rowR.top), Math.round(rowR.width), Math.round(rowR.height)],
        btn: [Math.round(ourR.left), Math.round(ourR.top), Math.round(ourR.width), Math.round(ourR.height)],
        wrapper: wrapper
          ? (Math.round(wrapper.getBoundingClientRect().width) + 'x' +
             Math.round(wrapper.getBoundingClientRect().height) +
             ' pos=' + wcs.position + ' overflow=' + wcs.overflow + ' pe=' + wcs.pointerEvents)
          : '(不在 btn-wrapper 里)',
        covered: covered.slice(0, 4)
      });
    });
    add('布局诊断-被按钮盖住的元素（逐行）', true, JSON.stringify(coveredReport));

    // 容器内部结构：我们的按钮在 .btn-wrapper 里是第几个、和页面自己的按钮是不是同一行
    var wrapperDetail = [];
    Array.prototype.forEach.call(document.querySelectorAll('.head-line'), function (row, index) {
      if (index > 2) return;
      var wrapper = row.querySelector('.btn-wrapper');
      if (!wrapper) return;
      var wcs = getComputedStyle(wrapper);
      var kids = Array.prototype.map.call(wrapper.children, function (el) {
        var r = el.getBoundingClientRect();
        return el.className.toString().slice(0, 28) +
          ' [' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' +
          Math.round(r.width) + 'x' + Math.round(r.height) + ']';
      });
      var headInfo = row.querySelector('.head-info');
      var icon = row.querySelector('.icon_level');
      var infoR = headInfo ? headInfo.getBoundingClientRect() : null;
      var iconR = icon ? icon.getBoundingClientRect() : null;
      wrapperDetail.push({
        display: wcs.display + ' wrap=' + wcs.flexWrap + ' dir=' + wcs.flexDirection +
          ' h=' + Math.round(wrapper.getBoundingClientRect().height),
        kids: kids,
        headInfo: infoR ? [Math.round(infoR.left), Math.round(infoR.top), Math.round(infoR.width), Math.round(infoR.height)] : null,
        icon: iconR ? [Math.round(iconR.left), Math.round(iconR.top), Math.round(iconR.width), Math.round(iconR.height)] : null,
        iconPE: icon ? getComputedStyle(icon).pointerEvents : '',
        iconZ: icon ? getComputedStyle(icon).zIndex : ''
      });
    });
    add('布局诊断-btn-wrapper 内部结构', true, JSON.stringify(wrapperDetail));

    /**
     * 按钮**下面**到底是什么：把按钮临时藏起来，再在同样几个点上取一次命中。
     * 这比"包围盒相交"准——相交不代表真的挡着，命中才算。
     */
    var underneath = [];
    Array.prototype.forEach.call(document.querySelectorAll('.head-line'), function (row, index) {
      row.scrollIntoView({ block: 'center' });
      var btns = Array.prototype.slice.call(row.querySelectorAll('.tb-eztb-btn'));
      var btn = btns[0];
      if (!btn) return;
      var r = btn.getBoundingClientRect();
      var points = [
        [r.left + 3, r.top + 3],
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.right - 3, r.bottom - 3]
      ];
      var describe = function (el) {
        if (!el) return 'null';
        return el.tagName + '.' + String(el.className || '').slice(0, 26) +
          '「' + String(el.textContent || '').replace(/\\s+/g, ' ').slice(0, 18) + '」';
      };
      var before = points.map(function (p) { return describe(document.elementFromPoint(p[0], p[1])); });
      // 注意：脚本自己的 CSS 里写了 visibility:visible !important，
      // 用普通 style.visibility='hidden' 是压不住的，必须带 important。
      var prevVis = btns.map(function (b) { return b.style.getPropertyValue('visibility'); });
      btns.forEach(function (b) { b.style.setProperty('visibility', 'hidden', 'important'); });
      var after = points.map(function (p) { return describe(document.elementFromPoint(p[0], p[1])); });
      btns.forEach(function (b, i) {
        if (prevVis[i]) b.style.setProperty('visibility', prevVis[i]);
        else b.style.removeProperty('visibility');
      });
      // 只有"盖住了别人"或"按钮跑出了自己的行/被挤到单独一行"才值得报
      var rowRect = row.getBoundingClientRect();
      var wrapper = row.querySelector('.btn-wrapper');
      var wrapperRect = wrapper.getBoundingClientRect();
      var aside = row.querySelector('.btn-track-wrapper, .button-wrapper');
      var asideRect = aside ? aside.getBoundingClientRect() : null;
      var coversOther = after.some(function (text) {
        return text !== 'null' &&
          text.indexOf('DIV.btn-wrapper') < 0 &&
          text.indexOf('DIV.head-line') < 0 &&
          text.indexOf('BODY') < 0 &&
          text.indexOf('HTML') < 0;
      });
      var sameLineAsPageButtons = !asideRect ||
        Math.abs(asideRect.top - r.top) < 4;
      var insideRow = r.top >= rowRect.top - 1 && r.bottom <= rowRect.bottom + 1;
      if (!coversOther && sameLineAsPageButtons && insideRow) return;
      underneath.push({
        行号: index,
        按钮数: btns.length,
        按钮矩形: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        所在行: [Math.round(rowRect.top), Math.round(rowRect.height)],
        容器: [Math.round(wrapperRect.top), Math.round(wrapperRect.height)],
        页面自己的按钮: asideRect ? [Math.round(asideRect.left), Math.round(asideRect.top)] : null,
        与页面按钮同一行: sameLineAsPageButtons,
        在行内: insideRow,
        盖住了: after,
        原本命中: before
      });
    });
    add('布局诊断-按钮底下是什么（藏起来再测命中）', true, JSON.stringify(underneath));
    add('布局诊断-异常行数量', true, underneath.length + ' 行异常（共 ' +
        document.querySelectorAll('.head-line').length + ' 行）');

    // 回复行里到底是谁浮在谁上面：容器定位方式 + 正文块位置
    var replyDetail = null;
    if (underneath.length) {
      var badRow = document.querySelectorAll('.head-line')[underneath[0].行号];
      badRow.scrollIntoView({ block: 'center' });
      var wrap = badRow.querySelector('.btn-wrapper');
      var text = badRow.parentElement
        ? badRow.parentElement.querySelector('.pb-rich-text')
        : null;
      var styleOf = function (el) {
        if (!el) return null;
        var cs = getComputedStyle(el);
        var r = el.getBoundingClientRect();
        return {
          el: el.tagName + '.' + String(el.className || '').slice(0, 30),
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          display: cs.display, position: cs.position, float: cs.cssFloat,
          top: cs.top, right: cs.right, z: cs.zIndex, overflow: cs.overflow
        };
      };
      replyDetail = {
        行: styleOf(badRow),
        容器: styleOf(wrap),
        按钮: styleOf(badRow.querySelector('.tb-eztb-btn')),
        正文: styleOf(text),
        行的兄弟: Array.prototype.map.call(badRow.parentElement.children, function (el) {
          return el.tagName + '.' + String(el.className || '').slice(0, 24);
        }),
        容器父节点: wrap ? wrap.parentElement.tagName + '.' +
          String(wrap.parentElement.className || '').slice(0, 30) : null
      };
    }
    add('布局诊断-回复行定位方式', true, JSON.stringify(replyDetail));

    // 祖先链：看清我们的按钮挂在谁里面、哪一层是固定高度/会裁剪
    var chain = [];
    var chainBtn = document.querySelector('.head-line .tb-eztb-btn');
    if (chainBtn) {
      var el = chainBtn;
      for (var depth = 0; el && depth < 8; depth++) {
        var r = el.getBoundingClientRect();
        var cs = getComputedStyle(el);
        chain.push({
          el: el.tagName + '.' + String(el.className || '').slice(0, 30),
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          display: cs.display,
          height: cs.height,
          overflow: cs.overflow,
          position: cs.position,
          pe: cs.pointerEvents,
          attrs: String(el.getAttributeNames ? el.getAttributeNames().filter(function (n) {
            return n.indexOf('data-v-') === 0;
          }).join(',') : '')
        });
        el = el.parentElement;
      }
    }
    add('布局诊断-按钮的祖先链', true, JSON.stringify(chain));

    var pbLoaded = Array.prototype.some.call(document.styleSheets, function (sheet) {
      return String(sheet.href || '').indexOf('pb.') >= 0;
    });
    add('布局诊断-pb.css 是否加载', pbLoaded,
        Array.prototype.map.call(document.styleSheets, function (s) {
          return String(s.href || '(inline)').split('/').pop();
        }).join(','));

    // 谁把 .btn-wrapper 定成了 block：把匹配它、并且声明了 display 的规则全列出来
    var wrapperEl = document.querySelector('.head-line .btn-wrapper');
    if (wrapperEl) {
      var hits = [];
      // 递归进 @media / @supports：不递归会漏掉页面大部分规则（踩过：命中列表全空）
      var walkRules = function (rules, sheetIndex, condition, visit) {
        Array.prototype.forEach.call(rules, function (rule) {
          if (rule.cssRules && rule.conditionText !== undefined) {
            walkRules(rule.cssRules, sheetIndex,
              condition ? condition + ' && ' + rule.conditionText : rule.conditionText, visit);
            return;
          }
          visit(rule, sheetIndex, condition);
        });
      };
      Array.prototype.forEach.call(document.styleSheets, function (sheet, sheetIndex) {
        var rules;
        try { rules = sheet.cssRules; } catch (e) { return; }
        walkRules(rules, sheetIndex, '', function (rule) {
          if (!rule.selectorText || !rule.style) return;
          if (!rule.style.display && !rule.style.height) return;
          var matched = false;
          try { matched = wrapperEl.matches(rule.selectorText); } catch (e) { return; }
          if (!matched) return;
          hits.push({
            sheet: sheetIndex,
            sel: rule.selectorText.slice(0, 90),
            media: String(rule.parentRule && rule.parentRule.conditionText || '').slice(0, 60),
            display: rule.style.display || '',
            height: rule.style.height || ''
          });
        });
      });
      add('布局诊断-作用于 .btn-wrapper 的 display/height 规则', true, JSON.stringify(hits));
      add('布局诊断-.btn-wrapper 是否匹配 scoped 选择器', true,
          wrapperEl.matches('.btn-wrapper[data-v-3c03969c]') + ' attrs=' +
          wrapperEl.getAttributeNames().join(','));
      add('布局诊断-各样式表的规则数', true, JSON.stringify(
        Array.prototype.map.call(document.styleSheets, function (sheet) {
          var n = -1;
          try { n = sheet.cssRules.length; } catch (e) { n = 'ERR:' + e.name; }
          return String(sheet.href || '(inline)').split('/').pop() + '=' + n;
        })
      ));
      add('布局诊断-用户信息行的高度规则', true, (function () {
        var info = document.querySelector('.head-line.user-info');
        if (!info) return '没有 .head-line.user-info';
        var found = [];
        Array.prototype.forEach.call(document.styleSheets, function (sheet, sheetIndex) {
          var rules;
          try { rules = sheet.cssRules; } catch (e) { return; }
          walkRules(rules, sheetIndex, '', function (rule) {
            if (!rule.selectorText || !rule.style || !rule.style.height) return;
            var ok = false;
            try { ok = info.matches(rule.selectorText); } catch (e) { return; }
            if (ok) {
              found.push(sheetIndex + ':' + rule.selectorText.slice(0, 60) +
                '{height:' + rule.style.height + '}' +
                (rule.parentRule && rule.parentRule.conditionText
                  ? ' @' + String(rule.parentRule.conditionText).slice(0, 40) : ''));
            }
          });
        });
        return 'computed=' + getComputedStyle(info).height + ' 规则=' + JSON.stringify(found.slice(0, 6));
      })());
    }
  }
  }

  fetch('/result', { method: 'POST', body: 'TBSTART\\n' + lines.join('\\n') + '\\nTBEND' }).catch(function () {});
}
setTimeout(report, __WAIT_MS);
`;

// 注入脚本先自检语法：它们写在模板字符串里，没转义的 \n 会把浏览器里的代码切断，
// 而报错信息（Invalid regular expression 之类）完全指不出位置。
for (const [name, source] of [
	["GM 桩", GM_STUB],
	["驱动", DRIVER],
]) {
	try {
		new Function(source);
	} catch (error) {
		console.error(`${name}脚本有语法错误：${error.message}`);
		process.exit(1);
	}
}

let resolveResult;
const resultPromise = new Promise((resolve) => {
	resolveResult = resolve;
});
let currentPage = "";
/** 当前这一轮快照的资源目录（「网页，完整」格式才有） */
let currentFilesDir = "";
/** 资源目录对应的 URL 前缀（同样只在「网页，完整」格式下有值） */
let currentFilesPrefixes = [];

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, "http://127.0.0.1");
	if (req.method === "GET" && url.pathname === "/") {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(currentPage);
		return;
	}
	if (url.pathname === "/result") {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		resolveResult(Buffer.concat(chunks).toString("utf8"));
		res.writeHead(200);
		res.end("ok");
		return;
	}
	if (url.pathname.startsWith("/css/")) {
		// 只按 basename 取文件，避免路径穿越
		const name = path.basename(decodeURIComponent(url.pathname.slice(5)));
		const file = path.join(CSS_DIR, name);
		if (name && fs.existsSync(file)) {
			res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
			res.end(fs.readFileSync(file));
			return;
		}
		res.writeHead(404);
		res.end();
		return;
	}
	// 「网页，完整」快照自带的资源（外部 CSS / 图片 / 字体）：按原目录名提供，
	// 页面里的相对引用就能原样命中（不要再改写 HTML，见 loadSavedPage 的注释）。
	{
		const decodedPath = decodeURIComponent(url.pathname);
		// 前缀有两种形态（URL 编码过 / 没编码），必须**用匹配到的那个**去切，
		// 否则编码长度和解码长度不同，切出来的文件名是错的（踩过一次：全部 404）。
		let name = null;
		if (currentFilesDir) {
			for (const prefix of currentFilesPrefixes) {
				if (url.pathname.startsWith(prefix)) {
					name = decodeURIComponent(url.pathname.slice(prefix.length));
					break;
				}
				if (decodedPath.startsWith(prefix)) {
					name = decodedPath.slice(prefix.length);
					break;
				}
			}
		}
		if (name !== null && currentFilesDir) {
			const file = path.resolve(currentFilesDir, name);
			// 只允许读该快照自己的 _files 目录，禁止路径穿越
			if (
				name &&
				file.startsWith(path.resolve(currentFilesDir)) &&
				fs.existsSync(file) &&
				fs.statSync(file).isFile()
			) {
				res.writeHead(200, {
					"content-type":
						MIME_BY_EXT[path.extname(file).toLowerCase()] ??
						"application/octet-stream",
				});
				res.end(fs.readFileSync(file));
				return;
			}
			res.writeHead(404);
			res.end();
			return;
		}
	}
	res.writeHead(404);
	res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

async function runSample(sample, minButtons) {
	const source = resolveSample(sample.file);
	if (!source) {
		console.log(
			`\n【${sample.name}】跳过：在 ${SAMPLE_DIRS.join(" 和 ")} 里都找不到 ${sample.file}`,
		);
		return null;
	}

	// 「网页，完整」格式（html + _files/）自带资源，直接用它；
	// 其余（MHTML）先解码，再按下面的规则把外部 CSS 换成本地缓存的那份。
	const saved = loadSavedPage(source);
	currentFilesDir = saved ? saved.filesDir : "";
	currentFilesPrefixes = saved ? saved.prefixes : [];
	const decoded = saved ? saved.html : extractHtml(source);
	// 把快照里引用的样式表换成本地缓存的那份（抓不到的保持原样，至少不影响其余断言）
	const html = decoded.replace(
		/https?:\/\/[^"'\s>]+\.css[^"'\s>]*/g,
		(absolute) => {
			const name = path.basename(absolute.split("?")[0]);
			if (!/\.css$/i.test(name)) return absolute;
			return fs.existsSync(path.join(CSS_DIR, name))
				? `/css/${name}`
				: absolute;
		},
	);
	const injection =
		// 窄容器场景：在脚本注入之前就把内容容器压窄，我们的宽度预算逻辑就会按窄行来算
		(sample.narrow
			? `<style>.pb-page-wrapper{width:420px !important;}</style>`
			: "") +
		`<script>${GM_STUB}</script>` +
		`<script>${bundle}</script>` +
		`<script>var __MIN_BUTTONS = ${minButtons}; var __WAIT_MS = 1200;` +
			`var __NARROW = ${sample.narrow ? "true" : "false"};` +
			`var __LAYOUT_PROBE = ${process.env.EZTB_LAYOUT_PROBE ? "true" : "false"};${DRIVER}</script>`;

	// 直接追加到文档末尾：无论页面结构如何都能执行到
	currentPage = /<\/body>/i.test(html)
		? html.replace(/<\/body>/i, `${injection}</body>`)
		: `${html}${injection}`;

	const resultPromiseForRun = new Promise((resolve) => {
		resolveResult = resolve;
	});
	const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "eztb-page-"));
	const child = spawn(
		browser,
		[
			"--headless=new",
			"--disable-extensions",
			"--no-first-run",
			"--disable-gpu",
			`--user-data-dir=${profileDir}`,
			`http://127.0.0.1:${port}/`,
		],
		{ stdio: "ignore" },
	);
	const raw = await Promise.race([
		resultPromiseForRun,
		new Promise((resolve) => setTimeout(() => resolve("__TIMEOUT__"), 60_000)),
	]);
	child.kill();
	return raw;
}

let failures = 0;
for (const sample of SAMPLES) {
	const raw = await runSample(sample, sample.expect.minButtons);
	if (raw === null) continue;
	console.log(`\n【${sample.name}】`);
	if (raw === "__TIMEOUT__" || !/TBSTART/.test(raw)) {
		console.error(`  FAIL  未取得结果：${String(raw).slice(0, 200)}`);
		failures += 1;
		continue;
	}
	for (const line of raw.match(/TBSTART([\s\S]*?)TBEND/)[1].trim().split("\n")) {
		const [status, label, detail] = line.split("|");
		if (status === "PASS") {
			console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
		} else {
			failures += 1;
			console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
		}
	}
}

server.close();
console.log(failures === 0 ? "\n真实页面回归全部通过。" : `\n${failures} 项失败。`);
process.exit(failures === 0 ? 0 : 1);
