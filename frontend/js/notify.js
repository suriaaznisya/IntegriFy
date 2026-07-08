export function showAlert(title, text = "", icon = "info") {
    return window.Swal.fire({
        title,
        text,
        icon,
        confirmButtonColor: "#111827"
    });
}

export function showToast(title, icon = "info") {
    return window.Swal.fire({
        title,
        icon,
        toast: true,
        position: "top-end",
        timer: 2500,
        showConfirmButton: false
    });
}

export function showLoading(title = "Processing...") {
    return window.Swal.fire({
        title,
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => {
            window.Swal.showLoading();
        }
    });
}

export function updateLoading(title) {
    if (window.Swal.isVisible()) {
        window.Swal.update({ title });
    }
}

export function hideAlert() {
    if (window.Swal.isVisible()) {
        window.Swal.close();
    }
}
