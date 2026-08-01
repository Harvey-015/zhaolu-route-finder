import { useEffect, useState } from "react";
import type { PublicLegalConfig } from "./legal.ts";
import {
  LEGAL_DOCUMENT_VERSION,
  loadLegalConfig,
} from "./legal.ts";

type LegalPageKind = "privacy" | "terms";

function OperatorDetails({
  config,
}: Readonly<{ config: PublicLegalConfig | null }>) {
  if (!config) {
    return (
      <p className="legal-warning" role="alert">
        运营主体与隐私联系方式尚未配置，本部署不能作为公开服务上线。
      </p>
    );
  }
  return (
    <dl className="operator-details">
      <div>
        <dt>运营者</dt>
        <dd>{config.operatorName}</dd>
      </div>
      <div>
        <dt>隐私联系</dt>
        <dd>{config.privacyContact}</dd>
      </div>
      <div>
        <dt>文档版本</dt>
        <dd>{config.documentVersion}</dd>
      </div>
    </dl>
  );
}

function PrivacyPolicy({
  config,
}: Readonly<{ config: PublicLegalConfig | null }>) {
  return (
    <>
      <h1>隐私政策</h1>
      <p className="legal-lead">
        本政策说明找路在路线规划、匿名收藏和现场反馈中如何处理信息。
      </p>
      <OperatorDetails config={config} />

      <h2>1. 我们处理的信息</h2>
      <p>
        当你规划路线时，我们处理起点地点或 WGS‑84 坐标、运动方式、目标距离、
        环境偏好和可选途经点。路线结果在请求期间用于展示和评分；是否允许导出或
        保存由路线 Provider policy 决定。
      </p>
      <p>
        只有你主动收藏时，我们才创建匿名设备会话，并保存随机会话标识、搜索条件、
        路线摘要和策略快照。策略允许时才保存几何。只有你主动评分时才保存 1–5 分
        反馈及你可选填写的备注。浏览器本地保存匿名会话令牌和当前版本的同意记录。
      </p>

      <h2>2. 目的与最少使用</h2>
      <p>
        上述信息仅用于生成和比较路线、恢复本设备收藏、接收现场质量反馈、限制滥用、
        排查故障和保障服务安全。应用日志不记录地点、路线几何、请求正文、令牌或 Key；
        部署平台的结构化日志保存期限为 {config?.logRetentionDays ?? "尚未配置"} 天。
      </p>

      <h2>3. 第三方与数据来源</h2>
      <p>
        为完成地点解析、道路路线和地图展示，必要的地点或坐标会由服务端或浏览器发送
        给高德开放平台。环境评分读取 ESA WorldCover 公开栅格数据。我们不会把匿名
        收藏、反馈或会话令牌提供给这些数据源。请同时阅读
        <a href="https://developer.amap.com/pages/privacy/">
          高德开放平台隐私权政策
        </a>
        。公开上线前，运营者仍应确认供应商合同、服务器地域和跨境数据边界。
      </p>

      <h2>4. 保存期限</h2>
      <ul>
        <li>匿名设备会话最长 30 天；</li>
        <li>高德路线收藏仅保留摘要，最长 24 小时；</li>
        <li>其他 Provider 按响应中的 policy snapshot 保存；</li>
        <li>现场反馈不晚于其对应收藏到期；</li>
        <li>到期数据由启动任务和每小时清理任务删除。</li>
      </ul>

      <h2>5. 你的权利</h2>
      <p>
        你可以逐条删除收藏，也可以在首页“隐私与数据”区域一键删除本匿名会话下的
        会话、全部收藏和全部反馈。删除后原令牌立即失效。你也可以取消同意并停止后续
        规划；查阅、解释、更正、投诉或其他请求可通过上方隐私联系方式提出。
      </p>

      <h2>6. 安全、未成年人和更新</h2>
      <p>
        我们使用同源 HTTPS、签名会话、最小化日志、访问限流和最短保存策略降低风险。
        本服务不面向不满 14 周岁的未成年人，也不应输入他人的家庭住址或其他敏感地点。
        处理规则发生实质变化时会更新文档版本，并要求重新确认。
      </p>
    </>
  );
}

function Terms({
  config,
}: Readonly<{ config: PublicLegalConfig | null }>) {
  return (
    <>
      <h1>服务条款与路线免责声明</h1>
      <p className="legal-lead">
        使用找路前，请理解路线推荐的用途、限制和第三方服务边界。
      </p>
      <OperatorDetails config={config} />

      <h2>1. 服务内容</h2>
      <p>
        找路基于地图 Provider 的可通行道路、公开环境数据和你的偏好生成跑步或骑行
        建议。评分是辅助比较，不承诺路线最优、持续可用或适合你的健康状况与技能。
      </p>

      <h2>2. 安全责任</h2>
      <p>
        路线仅供出行参考，不是专业导航、交通管制、道路开放、天气、医疗或紧急救援
        信息。实际道路可能施工、封闭、危险或禁止进入。出发前应核对官方信息，遵守
        交通法规和现场标识，佩戴适当装备，并根据身体状况随时停止活动。紧急情况请
        联系当地紧急服务。
      </p>

      <h2>3. 允许使用</h2>
      <p>
        不得利用服务侵入禁区、危害公共安全、抓取或批量转售地图数据、绕过限流、探测
        他人位置，或实施违法活动。地图和路线数据仍受相应 Provider 条款与权利限制；
        文件导出只在 policy 和部署授权同时允许时提供。
      </p>

      <h2>4. 第三方服务与可用性</h2>
      <p>
        高德与 ESA 数据服务可能变更、中断、限额或返回不完整信息。高德 App 交接只
        能打开起点到路线中点，不能保证复现找路生成的完整环线。相关使用还须遵守
        <a href="https://developer.amap.com/pages/terms/">
          高德开放平台服务协议
        </a>
        。
      </p>

      <h2>5. 收藏、反馈和终止</h2>
      <p>
        收藏绑定本浏览器中的匿名令牌，不是注册账号，不支持跨设备找回。你应确保反馈
        真实且不包含他人个人信息或违法内容。你可以随时删除全部数据并停止使用；运营者
        也可为安全、合规、维护或 Provider 变化暂停部分能力。
      </p>

      <h2>6. 联系与生效</h2>
      <p>
        本版本自 {LEGAL_DOCUMENT_VERSION} 起生效。有关服务或数据权利的问题，请使用
        上方公开联系方式联系运营者。
      </p>
    </>
  );
}

export function LegalPage({ kind }: Readonly<{ kind: LegalPageKind }>) {
  const [config, setConfig] = useState<PublicLegalConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void loadLegalConfig()
      .then(setConfig)
      .catch(() => setConfig(null))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="legal-shell">
      <header className="legal-topbar">
        <a href="/">← 返回找路</a>
        <span>找路 · 法律与隐私</span>
      </header>
      <main className="legal-document">
        {!loaded ? (
          <p className="legal-loading">正在读取运营者信息…</p>
        ) : kind === "privacy" ? (
          <PrivacyPolicy config={config} />
        ) : (
          <Terms config={config} />
        )}
      </main>
    </div>
  );
}
