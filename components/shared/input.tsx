"use client";
import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface InputProps {
  id: string;
  name: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  required?: boolean;
  placeholder?: string;
  label: string;
  rows?: number;
  className?: string;
}

export const InputField = ({
  id,
  name,
  type = 'text',
  value,
  onChange,
  required = false,
  placeholder,
  label,
  rows,
  className
}: InputProps) => {
  const isTextarea = type === 'textarea';

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm lg:text-base font-semibold text-black mb-1.5">
        {label} {required && '*'}
      </label>
      {isTextarea ? (
        <motion.textarea
          whileFocus={{ scale: 1.02 }}
          id={id}
          name={name}
          value={value}
          onChange={onChange}
          required={required}
          rows={rows || 6}
          className="w-full px-4 py-3 rounded border border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 resize-none"
          placeholder={placeholder}
        />
      ) : (
        <motion.input
          whileFocus={{ scale: 1.02 }}
          type={type}
          id={id}
          name={name}
          value={value}
          onChange={onChange}
          required={required}
          className="w-full px-4 py-3 rounded border border-gray-300 bg-white text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
          placeholder={placeholder}
        />
      )}
    </div>
  );
};