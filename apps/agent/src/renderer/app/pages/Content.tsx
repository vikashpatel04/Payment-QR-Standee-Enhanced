import { type AmbientItem, type LocalText, DISPLAY_LANGUAGES } from '@counterpay/core';
import type { AppSnapshot } from '@shared/api';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api';
import { Icon } from '../components/Icon';
import { Preview } from '../components/Preview';
import { updateConfig, useDraft } from '../hooks';
import ui from '../ui.module.css';
import styles from './pages.module.css';

function TextField({
  value,
  commit,
  placeholder,
  lang,
}: {
  value: string;
  commit: (next: string) => void;
  placeholder?: string;
  lang?: string;
}) {
  const draft = useDraft(value, commit);
  return <input className={ui.input} placeholder={placeholder} lang={lang} {...draft} />;
}

function LocalFields({
  text,
  langs,
  onChange,
  placeholderKey,
}: {
  text: LocalText | undefined;
  langs: string[];
  onChange: (text: LocalText) => void;
  placeholderKey?: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className={ui.stack}>
      {langs.map((lang) => (
        <label key={lang} className={ui.field}>
          <span className={ui.hint}>{t(`app.language.${lang}`)}</span>
          <TextField
            lang={lang}
            value={text?.[lang] ?? ''}
            placeholder={placeholderKey ? i18n.getFixedT(lang)(placeholderKey) : undefined}
            commit={(next) => {
              const merged: LocalText = { ...(text ?? {}), [lang]: next };
              if (!next) delete merged[lang];
              onChange(merged);
            }}
          />
        </label>
      ))}
    </div>
  );
}

function ItemEditor({
  item,
  langs,
  logoUrl,
  onChange,
}: {
  item: AmbientItem;
  langs: string[];
  logoUrl: string | null;
  onChange: (item: AmbientItem) => void;
}) {
  const { t } = useTranslation();
  switch (item.k) {
    case 'logo':
      return (
        <div className={ui.row}>
          {logoUrl ? <img className={styles.thumb} src={logoUrl} alt="" /> : null}
          <span className={ui.small}>{t(logoUrl ? 'app.content.logoSlide' : 'app.content.noLogo')}</span>
        </div>
      );
    case 'rating':
      return (
        <div className={ui.stack}>
          <label className={ui.field}>
            <span className={ui.hint}>{t('app.content.reviewLink')}</span>
            <TextField
              value={item.url}
              placeholder="https://g.page/r/…/review"
              commit={(url) => onChange({ ...item, url: url.trim() })}
            />
          </label>
          <LocalFields
            text={item.text}
            langs={langs}
            placeholderKey="display.rateUs"
            onChange={(text) => onChange(Object.keys(text).length ? { ...item, text } : { k: 'rating', url: item.url })}
          />
        </div>
      );
    case 'text':
      return <LocalFields text={item.text} langs={langs} onChange={(text) => onChange({ ...item, text })} />;
    case 'image':
      return (
        <div className={ui.row}>
          <img className={styles.thumb} src={`http://127.0.0.1:5178${item.src}`} alt="" />
          <button
            type="button"
            className={ui.button}
            onClick={() => void api.app.pickImage().then((src) => src && onChange({ k: 'image', src }))}
          >
            {t('app.content.change')}
          </button>
        </div>
      );
  }
}

/** The Ambient playlist, the Thanks scene and the shop's branding. */
export function Content({ snapshot }: { snapshot: AppSnapshot }) {
  const { t } = useTranslation();
  const { config } = snapshot;
  const items = config.ambient.items;
  const langs = config.language.display;
  const simulator = snapshot.displays.find((d) => d.config.driver === 'simulator');
  const logoUrl = config.brand.logoPath ? `http://127.0.0.1:5178/content/logo?v=${encodeURIComponent(config.brand.logoPath)}` : null;

  const setItems = (next: AmbientItem[]) => updateConfig({ ambient: { items: next } });
  const move = (index: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    setItems(next);
  };
  const add = async (k: AmbientItem['k']) => {
    if (k === 'image') {
      const src = await api.app.pickImage();
      if (src) setItems([...items, { k: 'image', src }]);
      return;
    }
    const item: AmbientItem = k === 'logo' ? { k } : k === 'rating' ? { k, url: '' } : { k: 'text', text: {} };
    setItems([...items, item]);
  };

  const primary = langs[0] ?? 'en';
  const secondary = langs[1] ?? '';

  return (
    <div className={ui.page}>
      <header className={ui.header}>
        <div>
          <h1 className={ui.title}>{t('app.nav.content')}</h1>
          <p className={ui.lead}>{t('app.content.lead')}</p>
        </div>
      </header>

      <div className={styles.contentLayout}>
        <div className={ui.stack} style={{ gap: 16 }}>
          <div className={ui.card}>
            <h2 className={ui.cardTitle}>{t('app.content.brand')}</h2>
            <div className={ui.stack}>
              <label className={ui.field}>
                <span className={ui.label}>{t('app.content.shopName')}</span>
                <TextField
                  value={config.brand.shopName}
                  placeholder={snapshot.payee?.name}
                  commit={(shopName) => updateConfig({ brand: { shopName } })}
                />
              </label>
              <div className={ui.row}>
                {logoUrl && <img className={styles.thumb} src={logoUrl} alt="" />}
                <button type="button" className={ui.button} onClick={() => void api.app.pickLogo()}>
                  {t(logoUrl ? 'app.content.changeLogo' : 'app.content.chooseLogo')}
                </button>
                {logoUrl && (
                  <button type="button" className={ui.ghost} onClick={() => updateConfig({ brand: { logoPath: '' } })}>
                    {t('app.content.removeLogo')}
                  </button>
                )}
                <label className={ui.row} style={{ marginLeft: 'auto' }}>
                  <span className={ui.label}>{t('app.content.accent')}</span>
                  <input
                    type="color"
                    className={styles.swatch}
                    value={config.brand.accent}
                    onChange={(e) => updateConfig({ brand: { accent: e.target.value } })}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className={ui.card}>
            <h2 className={ui.cardTitle}>{t('app.content.languages')}</h2>
            <div className={ui.row}>
              <label className={ui.field}>
                <span className={ui.label}>{t('app.content.primary')}</span>
                <select
                  className={ui.select}
                  value={primary}
                  onChange={(e) =>
                    updateConfig({
                      language: { display: [e.target.value, ...(secondary && secondary !== e.target.value ? [secondary] : [])] },
                    })
                  }
                >
                  {DISPLAY_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {t(`app.language.${lang}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={ui.field}>
                <span className={ui.label}>{t('app.content.secondary')}</span>
                <select
                  className={ui.select}
                  value={secondary}
                  onChange={(e) => updateConfig({ language: { display: [primary, ...(e.target.value ? [e.target.value] : [])] } })}
                >
                  <option value="">{t('app.content.none')}</option>
                  {DISPLAY_LANGUAGES.filter((lang) => lang !== primary).map((lang) => (
                    <option key={lang} value={lang}>
                      {t(`app.language.${lang}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className={ui.card}>
            <div className={ui.spread}>
              <h2 className={ui.cardTitle}>{t('app.content.playlist')}</h2>
              <label className={ui.row}>
                <span className={ui.small}>{t('app.content.slideSeconds')}</span>
                <select
                  className={ui.select}
                  value={config.ambient.slideSeconds}
                  onChange={(e) => updateConfig({ ambient: { slideSeconds: Number(e.target.value) } })}
                >
                  {[5, 8, 12, 20, 30, 60].map((s) => (
                    <option key={s} value={s}>
                      {t('app.history.seconds', { count: s })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              {items.map((item, index) => (
                <div key={`${item.k}-${index}`} className={styles.item}>
                  <span className={styles.itemKind}>{t(`app.content.kind.${item.k}`)}</span>
                  <ItemEditor
                    item={item}
                    langs={langs}
                    logoUrl={logoUrl}
                    onChange={(next) => setItems(items.map((it, i) => (i === index ? next : it)))}
                  />
                  <div className={styles.itemActions}>
                    <button type="button" className={ui.iconButton} disabled={index === 0} onClick={() => move(index, -1)} aria-label={t('app.content.up')}>
                      <Icon name="up" size={16} />
                    </button>
                    <button
                      type="button"
                      className={ui.iconButton}
                      disabled={index === items.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={t('app.content.down')}
                    >
                      <Icon name="down" size={16} />
                    </button>
                    <button
                      type="button"
                      className={ui.iconButton}
                      disabled={items.length === 1}
                      onClick={() => setItems(items.filter((_, i) => i !== index))}
                      aria-label={t('app.content.delete')}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className={ui.row} style={{ marginTop: 8 }}>
              {(['logo', 'rating', 'text', 'image'] as const).map((k) => (
                <button key={k} type="button" className={ui.button} onClick={() => void add(k)}>
                  <Icon name="plus" size={14} />
                  {t(`app.content.kind.${k}`)}
                </button>
              ))}
            </div>
          </div>

          <div className={ui.card}>
            <h2 className={ui.cardTitle}>{t('app.content.thanks')}</h2>
            <div className={ui.setting}>
              <div className={ui.settingText}>
                <span className={ui.settingName}>{t('app.content.thanksSeconds')}</span>
                <span className={ui.small}>{t('app.content.thanksHint')}</span>
              </div>
              <select
                className={ui.select}
                value={config.thanks.seconds}
                onChange={(e) => updateConfig({ thanks: { seconds: Number(e.target.value) } })}
              >
                {[0, 5, 10, 15, 30].map((s) => (
                  <option key={s} value={s}>
                    {s === 0 ? t('app.content.skipThanks') : t('app.history.seconds', { count: s })}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {simulator && (
          <div className={styles.stickyPreview}>
            <Preview view={simulator} snapshot={snapshot} height={330} />
            <span className={ui.small}>{t('app.content.preview')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
