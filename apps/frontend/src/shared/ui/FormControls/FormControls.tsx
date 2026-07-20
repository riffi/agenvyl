import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import styles from './FormControls.module.css';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} className={`${styles.control} ${styles.input} ${className}`} {...props} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className = '', ...props }, ref) {
  return <textarea ref={ref} className={`${styles.control} ${styles.textarea} ${className}`} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = '', ...props }, ref) {
  return <select ref={ref} className={`${styles.control} ${styles.select} ${className}`} {...props} />;
});
