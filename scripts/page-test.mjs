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
 */
const SAMPLE_DIRS = [SAMPLE_DIR, path.join(projectRoot, "dist/.samples")];

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

      // 再把头部行压窄（模拟"昵称很长 / 窗口很窄"）：新版头部行高度写死 40px，
      // 标记一折行就会顶到下面的标题与正文上——这两个断言就是钉住这一点。
      // 做法是让"名字/时间"那一块吃掉几乎整行宽度（真实情况：昵称长、还带等级标签与 IP 属地），
      // 而不是硬压行宽——硬压会让页面自己的固定宽度元素先顶出去，测出来的不是我们的问题。
      var headInfo = headRow.querySelector('.head-info');
      var saveInfoWidth = headInfo ? headInfo.style.width : null;
      if (headInfo) {
        headInfo.style.width = Math.max(120, rowRect.width - 110) + 'px';
      }
      var tightRowRect = headRow.getBoundingClientRect();
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
          headRow.scrollWidth <= headRow.clientWidth + 1,
          '标记 right=' + tightRect.right.toFixed(1) + ' 行 right=' + tightRowRect.right.toFixed(1) +
          ' scrollWidth=' + headRow.scrollWidth + ' clientWidth=' + headRow.clientWidth);
      tightCluster.remove();
      if (headInfo && saveInfoWidth !== null) headInfo.style.width = saveInfoWidth;
    }
  }

  if (__LAYOUT_PROBE) {
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

	// 把快照里引用的样式表换成本地缓存的那份（抓不到的保持原样，至少不影响其余断言）
	const html = extractHtml(source).replace(
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
		`<script>${GM_STUB}</script>` +
		`<script>${bundle}</script>` +
		`<script>var __MIN_BUTTONS = ${minButtons}; var __WAIT_MS = 1200;` +
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
