/** Path to a file in /public that still works when the app runs under a BASE_PATH. */
export const asset = (file: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/${file}`;
