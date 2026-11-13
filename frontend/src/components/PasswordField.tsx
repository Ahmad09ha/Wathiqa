"use client";

import {useState, type InputHTMLAttributes} from "react";
import {Eye, EyeOff} from "lucide-react";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
};

export default function PasswordField({label, ...inputProps}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const action = visible ? "إخفاء" : "إظهار";

  return <span className="w-password-field" dir="ltr">
    <input {...inputProps} className={["w-password-input", inputProps.className]
      .filter(Boolean).join(" ")} type={visible ? "text" : "password"}/>
    <button type="button" className="w-password-toggle"
      aria-label={action + " " + label} aria-pressed={visible}
      title={action + " " + label}
      onClick={() => setVisible(current => !current)}>
      {visible ? <EyeOff size={19} aria-hidden="true"/> :
        <Eye size={19} aria-hidden="true"/>}
    </button>
  </span>;
}
