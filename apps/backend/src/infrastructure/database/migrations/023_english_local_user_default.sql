UPDATE local_user_profiles
SET display_name='User',updated_at=now()
WHERE id='local-user' AND display_name='Пользователь';
