import { GHOST_BUTTON } from './cls';

export function Empty({ title, body, action, onAction, sectionLabel }: {
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
  sectionLabel?: string;
}) {
  const Container = sectionLabel ? 'section' : 'div';
  const Title = sectionLabel ? 'h2' : 'strong';
  return <Container aria-label={sectionLabel} className={`empty flex flex-col items-center gap-[4px] px-[24px] pt-[64px] text-center text-ink-3 ${sectionLabel ? 'pb-[12px]' : 'pb-[64px]'}`}>
    <svg className="i mb-[8px] size-[36px] flex-none fill-none stroke-current [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden="true"><use href="icons/sprite.svg#ginkgo" /></svg>
    <Title className="m-0 text-[16px] leading-[23px] font-bold text-ink-2">{title}</Title>
    <p className={`m-0 mb-[12px] text-[14px] ${sectionLabel ? 'leading-[20px]' : ''}`}>{body}</p>
    {action ? <button type="button" className={GHOST_BUTTON} onClick={onAction}>{action}</button> : null}
  </Container>;
}
