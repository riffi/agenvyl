import type { ImgHTMLAttributes } from 'react';

export type BrandLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'src'> & {
  variant?: 'default' | 'on-dark';
};

export const BrandLogo = ({ variant = 'default', ...props }: BrandLogoProps) => (
  <img {...props} src={variant === 'on-dark' ? '/agenvyl-logo-on-dark.svg' : '/agenvyl-logo.svg'} alt="" aria-hidden="true" />
);
